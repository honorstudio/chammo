#!/bin/sh
# scripts/direct 의 파이썬 없는 길 — 파이썬이 없는 깨끗한 윈도우 PC(git bash)에서 scripts/direct 가 이리로 넘어온다(ADR 0011).
# 앱이 읽는 <데이터>/direct.jsonl 에 같은 모양의 줄만 쓴다: ask · done · cancel, 읽기는 status · list.
# 파이썬판과 다른 점: 글을 자르지 않고 길면 거절(바이트로 자르면 한글이 깨져 앱이 기록 전체를 못 읽는다), 금액 검사는 '숫자 있나'만
LC_ALL=C
export LC_ALL

data_dir() {
  if [ -n "$(printf '%s' "$CHAMMO_HOME" | tr -d ' ')" ]; then
    printf '%s' "$CHAMMO_HOME"
  elif [ ! -d "$HOME/.chammo" ] && [ -d "$HOME/.honor-orchestrator" ]; then
    printf '%s' "$HOME/.honor-orchestrator"
  else
    printf '%s' "$HOME/.chammo"
  fi
}

DATA=$(data_dir)
LOG="$DATA/direct.jsonl"
EN=0
grep -Eq '"language" *: *"en"' "$DATA/config.json" 2>/dev/null && EN=1
T() { if [ "$EN" = 1 ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
die() { printf '%s\n' "$1" >&2; exit "${2:-2}"; }

usage_text() {
  T 'scripts/direct ask "<질문>" [--kind pay|send|delete|ops|login|other] [--amount] [--detail] [--what] [--yes] [--no] [--option …] · done <id> "<결과>" · cancel <id> · status <id> · list' \
           'scripts/direct ask "<question>" [--kind pay|send|delete|ops|login|other] [--amount] [--detail] [--what] [--yes] [--no] [--option …] · done <id> "<result>" · cancel <id> · status <id> · list'
}
usage() { die "$(usage_text)"; }

# JSON 글 — 역슬래시·따옴표·줄바꿈·탭은 이스케이프, 그 밖의 제어 글자는 뺀다. 바이트 그대로 지나가니 UTF-8 은 안 깨진다
js() {
  printf '%s' "$1" | awk 'BEGIN { ORS = "" } {
    gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "")
    gsub(/[\001-\010\013\014\016-\037\177]/, "")
    if (NR > 1) print "\\n"
    print
  }'
}

# 400자 상한 — 글자 수 대신 바이트(한글 3바이트)로 넉넉히 1,600. 깨진 UTF-8 도 여기서 거른다 —
# 줄 하나만 깨져도 앱이 기록 전체를 못 읽어 모든 카드가 사라진다(git bash 엔 iconv 가 없어 od + awk 로 바이트를 센다)
utf8_ok() {
  printf '%s' "$1" | od -An -v -tu1 | awk '{
    for (i = 1; i <= NF; i++) {
      b = $i + 0
      if (n) { if (b < 128 || b > 191 || (lo && b < lo) || (hi && b > hi)) { bad = 1; exit } lo = 0; hi = 0; n--; continue }
      if (b < 128) continue
      if (b >= 194 && b <= 223) n = 1
      else if (b >= 224 && b <= 239) { n = 2; if (b == 224) lo = 160; if (b == 237) hi = 159 }
      else if (b >= 240 && b <= 244) { n = 3; if (b == 240) lo = 144; if (b == 244) hi = 143 }
      else { bad = 1; exit }
    }
  } END { exit (bad || n) ? 1 : 0 }'
}
long() { [ "$(printf '%s' "$1" | wc -c | tr -d ' ')" -gt 1600 ] || ! utf8_ok "$1"; }

me() { j=${CLAUDE_JOB_DIR%/}; [ -n "$j" ] && basename "$j"; }

new_id() { od -An -N4 -tx1 /dev/urandom | tr -d ' \n'; }

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

append() {
  mkdir -p "$DATA" || die "$(T '데이터 폴더를 못 만들었어' 'could not create the data folder')" 1
  (umask 077; printf '%s\n' "$1" >> "$LOG") || die "$(T '기록을 못 썼어' 'could not write the log')" 1
}

# 그 카드 줄들(id 가 맞는 줄) — 파이썬판은 '": "', 앱(Rust)은 '":"' 로 쓴다
rows_of() { grep -E "\"id\": ?\"$1\"" "$LOG" 2>/dev/null; }
has_type() { printf '%s\n' "$1" | grep -Eq "\"type\": ?\"$2\""; }
# 칸 하나(보여 주기용) — 이스케이프된 따옴표(\")도 넘어가고, 보일 땐 \" → " · \n → 띄어쓰기
field() { printf '%s\n' "$1" | sed -En "s/.*\"$2\": ?\"(([^\"\\\\]|\\\\.)*)\".*/\1/p" | head -n 1 | sed -e 's/\\"/"/g' -e 's/\\n/ /g' -e 's/\\\\/\\/g'; }

# 카드 상태 — 파이썬판 card_view·앱 domain/directAsk·Rust direct::check 와 같은 순서 규칙: wait · answered · done · closed(거둠) · old(지난 질문).
# 같은 세션의 뒤 ask 가 오면 답 전 카드는 지난 질문 — 결제(pay)·연결 요청(link)은 안 밀린다(2026-10-22 아이맥 001)
state_of() {
  rs=$(rows_of "$1")
  ask=$(printf '%s\n' "$rs" | grep -E '"type": ?"ask"' | head -n 1)
  [ -n "$ask" ] || return 1
  st=$(awk -v id="$1" '
    function f(l, k,   s) { if (!match(l, "\"" k "\": ?\"[^\"]*\"")) return ""; s = substr(l, RSTART, RLENGTH); sub(/^"[^"]*": ?"/, "", s); return substr(s, 1, length(s) - 1) }
    { t = f($0, "type"); i = f($0, "id") }
    !on { if (t == "ask" && i == id) { on = 1; from = f($0, "from"); k = f($0, "kind"); stays = (k == "pay" || k == "link"); st = "wait" } next }
    i == id && t == "answer" { ans = 1; next }
    i == id && t == "answer-failed" { ans = 0; next }
    i == id && t == "done" && st == "wait" { st = "done"; next }
    i == id && t == "cancel" && st == "wait" { st = "closed"; next }
    t == "ask" && !stays && !ans && st == "wait" && f($0, "from") == from { st = "old" }
    END { if (st == "wait" && ans) st = "answered"; print st }' "$LOG")
  shown=$(printf '%s\n' "$rs" | grep -E '"type": ?"shown"' | head -n 1)
  return 0
}

# 글 앞부분 n 바이트 — 끝에 걸린 한글(여러 바이트) 반쪽은 뺀다
head_text() {
  printf '%s' "$1" | awk -v n="$2" '{ s = s (NR > 1 ? " " : "") $0 } END {
    if (length(s) > n) {
      s = substr(s, 1, n)
      while (length(s) && substr(s, length(s)) >= "\200" && substr(s, length(s)) < "\300") s = substr(s, 1, length(s) - 1)
      if (length(s) && substr(s, length(s)) >= "\300") s = substr(s, 1, length(s) - 1)
    }
    printf "%s", s
  }'
}

status_text() {
  q=$(field "$ask" q | cut -c1-240)
  case $st in
    wait) w=$(T '기다림' 'waiting') ;; answered) w=$(T '답함' 'answered') ;; closed) w=$(T '거둠' 'withdrawn') ;;
    old) w=$(T '지난 질문' 'replaced') ;; *) w=$(T '처리됨' 'done') ;;
  esac
  printf '%s · %s · %s · %s\n' "$1" "$(field "$ask" kind)" "$(field "$ask" from)" "$q"
  printf '%s\n' "$(T "상태: $w" "State: $w")"
  if [ -n "$shown" ]; then
    printf '%s\n' "$(T "앱에 보임 — $(field "$shown" where)" "Shown in the app — $(field "$shown" where)")"
  else
    printf '%s\n' "$(T '앱에 아직 안 보임 — 앱이 꺼졌거나 카드가 어느 화면에도 안 그려졌어' 'Not shown in the app yet — the app is off or no screen drew the card')"
  fi
}

[ $# -ge 1 ] || usage
# --help·-h 는 어디 있든 도움말만 — ask --help 가 '--help' 를 질문으로 한 빈 카드를 띄웠다(2026-10-22 아이맥 002)
for a in "$@"; do
  case $a in --help|-h) usage_text; printf '\n'; exit 0 ;; esac
done
cmd=$1
shift
case $cmd in
  status)
    [ $# -ge 1 ] || usage
    case $1 in *[!0-9a-f]*|'') die "$1: $(T '그런 카드 없음' 'no such card')" ;; esac
    state_of "$1" || die "$1: $(T '그런 카드 없음' 'no such card')"
    status_text "$1"
    [ "$st" = wait ] && [ -z "$shown" ] && exit 4
    exit 0 ;;
  list)
    ids=$(grep -E '"type": ?"ask"' "$LOG" 2>/dev/null | sed -n 's/.*"id": \{0,1\}"\([0-9a-f]\{8\}\)".*/\1/p')
    n=0
    for i in $ids; do
      state_of "$i" || continue
      case $st in wait|answered) ;; *) continue ;; esac
      [ $n -gt 0 ] && printf '\n'
      status_text "$i"
      n=$((n + 1))
    done
    [ $n -eq 0 ] && T '열린 카드 없음' 'No open cards' && printf '\n'
    exit 0 ;;
  ask|done|cancel) ;;
  *) usage ;;
esac

who=$(me)
[ -n "$who" ] || die "$(T '백그라운드 세션에서만 부를 수 있어(CLAUDE_JOB_DIR 없음)' 'Only from a background session (no CLAUDE_JOB_DIR)')"
case $who in *[!0-9A-Za-z_-]*) die "bad session id" ;; esac

if [ "$cmd" != ask ]; then
  [ $# -ge 1 ] || usage
  id=$1
  case $id in *[!0-9a-f]*|'') die "$id: $(T '이 세션이 연 카드가 아니야' 'not a card this session opened')" ;; esac
  rows_of "$id" | grep -E '"type": ?"ask"' | grep -Eq "\"from\": ?\"$who\"" || die "$id: $(T '이 세션이 연 카드가 아니야' 'not a card this session opened')"
  if [ "$cmd" = done ]; then
    note=${2-}
    long "$note" && die "$(T '결과 글이 너무 길거나(400자까지) 글자가 깨졌어' 'result too long (400 chars max) or not valid UTF-8')"
    append "{\"ts\":\"$(now)\",\"type\":\"done\",\"id\":\"$id\",\"note\":\"$(js "$note")\"}"
  else
    append "{\"ts\":\"$(now)\",\"type\":\"cancel\",\"id\":\"$id\"}"
  fi
  T '기록했어' 'Recorded'; printf '\n'
  exit 0
fi

[ $# -ge 1 ] || usage
q=$1
shift
case $q in
  -[A-Za-z]*|--[A-Za-z]*) die "$(T "질문이 먼저 와야 해 — \"$(head_text "$q" 40)\" 는 옵션이야: scripts/direct ask \"<질문>\" [--kind …]" "The question comes first — \"$(head_text "$q" 40)\" is an option: scripts/direct ask \"<question>\" [--kind …]")" ;;
esac
kind=other amount= detail= what= yes= no= opts= nopt=0
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || die "$(T "모르는 옵션: $1" "unknown option: $1")"
  v=$2
  long "$v" && die "$(T "$1 글이 너무 길거나(400자까지) 글자가 깨졌어" "$1 is too long (400 chars max) or not valid UTF-8")"
  case $1 in
    --kind) kind=$v ;; --amount) amount=$v ;; --detail) detail=$v ;; --what) what=$v ;; --yes) yes=$v ;; --no) no=$v ;;
    --option) if [ $nopt -lt 6 ]; then opts="$opts${opts:+,}\"$(js "$v")\""; nopt=$((nopt + 1)); fi ;;
    *) die "$(T "모르는 옵션: $1" "unknown option: $1")" ;;
  esac
  shift 2
done
long "$q" && die "$(T '질문이 너무 길거나(400자까지) 글자가 깨졌어 — 줄여서 다시' 'the question is too long (400 chars max) or not valid UTF-8 — shorten it')"
case $kind in pay|send|delete|ops|login|other) ;; *) die "$(T '--kind 는 pay|send|delete|ops|login|other 중 하나' '--kind must be one of pay|send|delete|ops|login|other')" ;; esac
if [ -n "$amount" ] && ! printf '%s' "$amount" | grep -q '[0-9]'; then
  die "$(T "금액이 비었어 — 큰따옴표 안의 \$99 는 셸이 지운다. 작은따옴표로 다시: --amount 'US\$99'" "The amount is empty — the shell eats \$99 inside double quotes. Again with single quotes: --amount 'US\$99'")"
fi
if [ -z "$yes" ]; then
  case $kind in
    pay) yes=$(T '결제 승인' 'Approve payment') ;; send) yes=$(T '보내기 승인' 'Approve sending') ;; delete) yes=$(T '삭제 승인' 'Approve deletion') ;;
    ops) yes=$(T '운영 반영 승인' 'Approve') ;; login) yes=$(T '다 했어' 'Done') ;; *) yes=$(T '승인' 'Approve') ;;
  esac
fi
[ -n "$no" ] || no=$(T '거절' 'Decline')
# 이 ask 로 지난 질문이 될 앞 카드 — 말없이 바꾸면 띄운 세션은 아직 떠 있다고 믿는다
gone=
for i in $(grep -E '"type": ?"ask"' "$LOG" 2>/dev/null | grep -E "\"from\": ?\"$who\"" | sed -n 's/.*"id": \{0,1\}"\([0-9a-f]\{8\}\)".*/\1/p'); do
  state_of "$i" || continue
  [ "$st" = wait ] || continue
  case $(field "$ask" kind) in pay|link) continue ;; esac
  g=$(head_text "$(field "$ask" q)" 90)
  gone="$gone$(T "앞 카드($i·$g)를 지난 질문으로 바꿨어 — 그 카드는 대기함에서 빠지고 더 답할 수 없다" "Replaced the earlier card ($i·$g) — it leaves the inbox and can no longer be answered")
"
done
cwd=$(pwd -W 2>/dev/null || pwd)
id=$(new_id)
case $id in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; *) die "$(T '카드 번호를 못 만들었어' 'could not make a card id')" 1 ;; esac
row="{\"ts\":\"$(now)\",\"type\":\"ask\",\"id\":\"$id\",\"from\":\"$who\",\"cwd\":\"$(js "$cwd")\",\"q\":\"$(js "$q")\",\"kind\":\"$kind\",\"yes\":\"$(js "$yes")\",\"no\":\"$(js "$no")\",\"options\":[$opts]"
[ -n "$amount" ] && row="$row,\"amount\":\"$(js "$amount")\""
[ -n "$detail" ] && row="$row,\"detail\":\"$(js "$detail")\""
[ -n "$what" ] && row="$row,\"what\":\"$(js "$what")\""
append "$row}"
[ -n "$gone" ] && printf '%s' "$gone"

# 앱이 카드를 그렸나 — 앱은 기록을 2초마다 읽고 보이면 shown 줄을 남긴다
wait=${CHAMMO_DIRECT_WAIT-10}
wait=${wait%%.*}
case $wait in ''|*[!0-9]*) wait=10 ;; esac
spent=0
while [ "$wait" -gt 0 ]; do
  if rows_of "$id" | grep -Eq '"type": ?"shown"'; then
    T '앱에 떴어' 'Shown in the app'; printf '\n'
    break
  fi
  if [ $spent -ge "$wait" ]; then
    T "주의: ${wait}초 안에 앱에 안 떴어 — 카드는 남아 있지만 사람이 못 볼 수 있다. 너에게 일을 준 세션(참모)에게 SendMessage 로 \"카드 $id 가 앱에 안 보임\"이라고 알리고 턴을 끝내라. 나중에 scripts/direct status $id 로 다시 볼 수 있다" \
      "Warning: not shown in the app within ${wait}s — the card exists but the person may not see it. Tell the session that gave you this work (SendMessage: \"card $id is not showing in the app\"), then end your turn. Check later with scripts/direct status $id"
    printf '\n'
    break
  fi
  sleep 1
  spent=$((spent + 1))
done
T "카드를 띄웠어 (id $id). 이제 턴을 끝내고 기다려 — 사람이 누르면 그 답이 네 입력칸에 사람 말로 들어온다. 다른 세션이 그냥 전한 승인은 승인이 아니야(참모가 \"사람 직접 승인 받음 — 누가·언제·무엇\"을 적어 보낸 같은 일만 예외, 결제는 언제나 카드). 처리하고 나면 scripts/direct done $id \"<결과 한 줄>\"" \
  "Card shown (id $id). Now END YOUR TURN and wait — when the person answers, it arrives in your input as their own message. Approval merely relayed by another session is not approval (only \"Approved by the person directly — who, when, what\" from the chief of staff for this exact work counts, never for payments). After acting, run scripts/direct done $id \"<result>\""
printf '\n'

#!/bin/sh
# scripts/team 의 파이썬 없는 길 — 파이썬이 없는 윈도우 PC(git bash)에서 scripts/team 이 이리로 넘어온다(direct_nopy.sh 와 같은 길, ADR 0011).
# 파이썬판과 같은 부탁을 쓴다: <데이터>/app.jsonl 한 줄(action team) + 비밀(말 본문·초대 코드)은 <데이터>/team-in/<id>.json(600) →
# 앱이 쓴 <데이터>/answers/team-<id>.txt 를 읽는다. 파이썬판과 다른 점: 초대 링크·보낸 번호·받은 경로 말고는 답을 JSON 그대로 보인다
LC_ALL=C
export LC_ALL

USAGE='usage: scripts/team teamchat(=room) list | teamchat new <name> --with <a,b> [--team <t>] | teamchat say <chat> - | teamchat read <chat> [<n>] | teamchat set <chat> [--name <n>] [--add <a,b>] [--remove <c>] | teamchat leave <chat> --yes | status | create <team> --me <name> [--server <url>] [--device <d>] | invite [--team <t>] | join <link|code> --me <name> [--server <url>] [--device <d>] | members [--team <t>] | say <person> <text|-> [--team <t>] | use <team> | leave [--team <t>] --yes | kick <person> [--team <t>] --yes | role <person> owner|member [--team <t>] --yes | inbox [<n>] | deliver-to <assistant> | forget --yes | locker ls|put <file…>|get <name|id>|rm <name|id> [--folder <f>] [--to <dir>] [--trash] [--team <t>] | login [--server <url>] [--device <d>] | devices [rename <device> <name> | remove <device> --yes] | self-say <text|->'

die() { printf '%s\n' "$1" >&2; exit "${2:-2}"; }
usage() { die "$USAGE"; }

# 데이터 폴더 — 앱·파이썬판과 같은 규칙: $CHAMMO_HOME → ~/.chammo(옛 설치는 ~/.honor-orchestrator)
data_dir() {
  if [ -n "$(printf '%s' "$CHAMMO_HOME" | tr -d ' ')" ]; then
    printf '%s' "$CHAMMO_HOME"
  elif [ ! -d "$HOME/.chammo" ] && [ -d "$HOME/.honor-orchestrator" ]; then
    printf '%s' "$HOME/.honor-orchestrator"
  else
    printf '%s' "$HOME/.chammo"
  fi
}

# JSON 글 — direct_nopy.sh 와 같다(역슬래시·따옴표·줄바꿈·탭은 이스케이프, 그 밖의 제어 글자는 뺀다)
js() {
  printf '%s' "$1" | awk 'BEGIN { ORS = "" } {
    gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "")
    gsub(/[\001-\010\013\014\016-\037\177]/, "")
    if (NR > 1) print "\\n"
    print
  }'
}
q() { printf '"%s"' "$(js "$1")"; }

# 깨진 UTF-8 이면 거절 — 줄 하나만 깨져도 앱이 app.jsonl 을 못 읽는다(direct_nopy.sh 와 같다)
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

hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

# 쉼표로 나눈 이름 → JSON 배열(빈 칸·앞뒤 띄어쓰기 뺌) — 파이썬판 people()
people() {
  out=''
  rest=$1
  while [ -n "$rest" ]; do
    case $rest in *,*) one=${rest%%,*}; rest=${rest#*,} ;; *) one=$rest; rest='' ;; esac
    one=$(printf '%s' "$one" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    [ -n "$one" ] && out="$out${out:+,}$(q "$one")"
  done
  printf '[%s]' "$out"
}

# 절대 경로(파이썬판 realpath) — 윈도우 git bash 면 앱(윈도우 exe)이 읽게 C:\… 로
abs_path() {
  p=$1
  case $p in '~'|'~/'*) p="$HOME${p#\~}" ;; esac
  if [ -d "$p" ]; then a=$(cd "$p" && pwd -P)
  else
    d=$(dirname "$p")
    if [ -d "$d" ]; then a="$(cd "$d" && pwd -P)/$(basename "$p")"
    else case $p in /*) a=$p ;; *) a="$(pwd -P)/$p" ;; esac
    fi
  fi
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$a"; else printf '%s' "$a"; fi
}

this_device() { (hostname 2>/dev/null || uname -n) | cut -d. -f1 | cut -c1-40; }

# 인자 → 옵션 칸 + 나머지(eval 로 다시 세움 — 띄어쓰기·따옴표가 든 인자도 그대로)
yes=0; trash=0; rest=''
o_me=; o_server=; o_device=; o_team=; o_folder=; o_to=; o_with=; o_name=; o_add=; o_remove=
h_me=0; h_team=0; h_name=0; h_add=0; h_remove=0; h_to=0
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
while [ $# -gt 0 ]; do
  case $1 in
    --yes) yes=1 ;;
    --trash) trash=1 ;;
    --me|--server|--device|--team|--folder|--to|--with|--name|--add|--remove)
      [ $# -ge 2 ] || usage
      k=${1#--}; eval "o_$k=\$2"
      case $k in me|team|name|add|remove|to) eval "h_$k=1" ;; esac
      shift ;;
    *) rest="$rest $(quote "$1")" ;;
  esac
  shift
done
eval "set -- $rest"
[ $# -gt 0 ] || usage
for a in "$@" "$o_me" "$o_server" "$o_device" "$o_team" "$o_folder" "$o_to" "$o_with" "$o_name" "$o_add" "$o_remove"; do
  utf8_ok "$a" || die "$(printf '%s' '글이 깨졌어(UTF-8 아님) / not valid UTF-8')"
done

verb=$1; shift
TEAM=''; [ "$h_team" = 1 ] && TEAM=",\"team\":$(q "$o_team")"
DEV=${o_device:-$(this_device)}
# 숫자 칸 — $(…) 안에서 die 하면 그 껍데기만 끝나니 먼저 검사(isnum) 뒤 값만 쓴다
isnum() { case $1 in ''|*[!0-9]*) usage ;; esac; }
joined() { printf '%s' "$*"; }
ARG=''; SECRET=''; CID=0; WAIT=60
case $verb in
  status) [ $# -eq 0 ] || usage; ARG='"verb":"status"' ;;
  invite|members) [ $# -eq 0 ] || usage; ARG="\"verb\":\"$verb\"$TEAM" ;;
  use) [ $# -eq 1 ] || usage; ARG="\"verb\":\"use\",\"team\":$(q "$1")" ;;
  leave) [ $# -eq 0 ] && [ "$yes" = 1 ] || usage; ARG="\"verb\":\"leave\",\"team\":$(q "$o_team"),\"yes\":true" ;;
  kick) [ $# -eq 1 ] && [ "$yes" = 1 ] || usage; ARG="\"verb\":\"kick\",\"who\":$(q "$1"),\"team\":$(q "$o_team"),\"yes\":true" ;;
  role)
    [ $# -eq 2 ] && [ "$yes" = 1 ] || usage
    case $2 in owner|member) ;; *) usage ;; esac
    ARG="\"verb\":\"role\",\"who\":$(q "$1"),\"role\":\"$2\",\"team\":$(q "$o_team"),\"yes\":true" ;;
  create) [ $# -ge 1 ] && [ -n "$o_me" ] || usage
    ARG="\"verb\":\"create\",\"team\":$(q "$(joined "$@")"),\"me\":$(q "$o_me"),\"server\":$(q "$o_server"),\"device\":$(q "$DEV")" ;;
  join) [ $# -eq 1 ] && [ -n "$o_me" ] || usage
    ARG="\"verb\":\"join\",\"me\":$(q "$o_me"),\"server\":$(q "$o_server"),\"device\":$(q "$DEV")"; SECRET="\"code\":$(q "$1")" ;;
  say) [ $# -ge 2 ] || usage; to=$1; shift
    text=$(joined "$@"); [ "$text" = - ] && text=$(cat)
    ARG="\"verb\":\"say\",\"to\":$(q "$to")$TEAM"; SECRET="\"text\":$(q "$text")"; CID=1 ;;
  self-say) [ $# -ge 1 ] || usage
    text=$(joined "$@"); [ "$text" = - ] && text=$(cat)
    ARG='"verb":"self-say"'; SECRET="\"text\":$(q "$text")"; CID=1 ;;
  inbox) [ $# -le 1 ] || usage; n=${1:-20}; isnum "$n"; ARG="\"verb\":\"inbox\",\"n\":$n" ;;
  login) [ $# -eq 0 ] || usage; WAIT=620
    printf '%s\n' 'opening the browser — the person signs in with Google there / 브라우저를 열었어 — 그 사람이 구글로 로그인해' >&2
    ARG="\"verb\":\"login\",\"server\":$(q "$o_server"),\"device\":$(q "$DEV")" ;;
  devices)
    if [ $# -eq 0 ]; then ARG='"verb":"devices"'
    elif [ "$1" = rename ] && [ $# -ge 3 ]; then d=$2; shift 2; ARG="\"verb\":\"device-rename\",\"device\":$(q "$d"),\"name\":$(q "$(joined "$@")")"
    elif [ "$1" = remove ] && [ $# -eq 2 ] && [ "$yes" = 1 ]; then ARG="\"verb\":\"device-remove\",\"device\":$(q "$2"),\"yes\":true"
    else usage; fi ;;
  room|teamchat)  # 팀챗 — 안내문 이름은 teamchat, room 은 호환(파이썬판과 같은 길)
    sub=${1:-}; [ $# -gt 0 ] && shift
    case $sub in
      list) [ $# -eq 0 ] || usage; ARG='"verb":"rooms"' ;;
      new) [ $# -ge 1 ] && [ "$(people "$o_with")" != '[]' ] || usage
        ARG="\"verb\":\"room-new\",\"name\":$(q "$(joined "$@")"),\"with\":$(people "$o_with")$TEAM" ;;
      # 방 말은 stdin heredoc 만 — 남의 글을 따옴표로 치면 $(…) 가 풀린다
      say) [ $# -eq 2 ] && [ "$2" = - ] || usage
        text=$(cat); ARG="\"verb\":\"room-say\",\"room\":$(q "$1")"; SECRET="\"text\":$(q "$text")"; CID=1 ;;
      read) [ $# -ge 1 ] && [ $# -le 2 ] || usage; n=${2:-20}; isnum "$n"; ARG="\"verb\":\"room-read\",\"room\":$(q "$1"),\"n\":$n" ;;
      set) [ $# -eq 1 ] && [ $((h_name + h_add + h_remove)) -gt 0 ] || usage
        ARG="\"verb\":\"room-set\",\"room\":$(q "$1"),\"add\":$(people "$o_add"),\"remove\":$(people "$o_remove")"
        [ -n "$o_name" ] && ARG="$ARG,\"name\":$(q "$o_name")" ;;
      leave) [ $# -eq 1 ] && [ "$yes" = 1 ] || usage; ARG="\"verb\":\"room-leave\",\"room\":$(q "$1"),\"yes\":true" ;;
      *) usage ;;
    esac ;;
  locker)
    sub=${1:-}; [ $# -gt 0 ] && shift
    case $sub in
      ls) [ $# -eq 0 ] || usage
        t=false; [ "$trash" = 1 ] && t=true
        ARG="\"verb\":\"locker-ls\",\"team\":$(q "$o_team"),\"trash\":$t" ;;
      put) [ $# -ge 1 ] || usage; WAIT=3600
        miss=''; paths=''
        for n in "$@"; do
          f=$n; case $f in '~/'*) f="$HOME${f#\~}" ;; esac
          if [ -f "$f" ]; then paths="$paths${paths:+,}$(q "$(abs_path "$f")")"; else miss="$miss${miss:+, }$n"; fi
        done
        [ -z "$miss" ] || die "no such file / 파일이 없어: $miss"
        ARG="\"verb\":\"locker-put\",\"paths\":[$paths],\"folder\":$(q "$o_folder"),\"team\":$(q "$o_team")" ;;
      get) [ $# -eq 1 ] || usage; WAIT=3600
        to=''; [ -n "$o_to" ] && to=$(abs_path "$o_to")
        ARG="\"verb\":\"locker-get\",\"file\":$(q "$1"),\"to\":$(q "$to"),\"team\":$(q "$o_team")" ;;
      rm) [ $# -eq 1 ] || usage; ARG="\"verb\":\"locker-rm\",\"file\":$(q "$1"),\"team\":$(q "$o_team")" ;;
      *) usage ;;
    esac ;;
  forget) [ $# -eq 0 ] && [ "$yes" = 1 ] || usage; ARG='"verb":"forget"' ;;
  deliver-to) [ $# -eq 1 ] || usage; ARG="\"verb\":\"deliver-to\",\"name\":$(q "$1")" ;;
  *) usage ;;
esac
[ -z "${text+x}" ] || utf8_ok "$text" || die '글이 깨졌어(UTF-8 아님) / not valid UTF-8'
[ "$CID" = 1 ] && ARG="$ARG,\"cid\":\"tc-$(hex 6)\""

DATA=$(data_dir)
RID=$(hex 6)
mkdir -p "$DATA" || die 'could not create the data folder / 데이터 폴더를 못 만들었어' 1
if [ -n "$SECRET" ]; then
  (umask 077; mkdir -p "$DATA/team-in" && printf '{%s}' "$SECRET" > "$DATA/team-in/$RID.json") || die 'could not write the handoff / 건네기 파일을 못 썼어' 1
  ARG="$ARG,\"in\":\"$RID\""
fi
TS=$(date -u +%Y-%m-%dT%H:%M:%S+00:00)
(umask 077; printf '{"ts":"%s","action":"team","arg":{%s},"id":"%s"}\n' "$TS" "$ARG" "$RID" >> "$DATA/app.jsonl") || die 'could not write app.jsonl / 기록을 못 썼어' 1
chmod 600 "$DATA/app.jsonl" 2>/dev/null

# 답 기다리기 — 0.2초마다(앱 꺼져 있으면 WAIT 초 뒤 실패)
WAIT=${CHAMMO_TEAM_WAIT:-$WAIT}
MINE="$DATA/answers/team-$RID.txt"
i=0
while [ "$i" -lt $((WAIT * 5)) ]; do
  if [ -f "$MINE" ] && [ "$(head -n 1 "$MINE")" = "#id $RID" ]; then
    BODY=$(sed 1d "$MINE")
    rm -f "$MINE"
    break
  fi
  sleep 0.2
  i=$((i + 1))
done
[ -n "${BODY+x}" ] || die "failed / 못 했어: Chammo did not answer in ${WAIT}s — is the app open? / 앱이 답하지 않았어 — Chammo 가 켜져 있어야 해" 1

# 칸 하나(글) — 이스케이프된 따옴표도 넘어가고 \" → " · \\ → \ 로
field() { printf '%s\n' "$BODY" | sed -En "s/.*\"$1\": ?\"(([^\"\\\\]|\\\\.)*)\".*/\1/p" | head -n 1 | sed -e 's/\\"/"/g' -e 's/\\\\/\\/g'; }
seq_of() { printf '%s\n' "$BODY" | sed -En 's/.*"seq": ?([0-9]+).*/\1/p' | head -n 1; }
if ! printf '%s' "$BODY" | grep -Eq '"ok": ?true'; then
  e=$(field error); die "failed / 못 했어: ${e:-$BODY}" 1
fi
case $verb in
  invite) printf '%s\n' 'invite (one use, 24h) / 초대(한 번·24시간) — give this to the person / 이걸 그 사람에게:'; field link ;;
  say) printf 'sent / 보냄 — team#%s\n' "$(seq_of)" ;;
  self-say) printf 'sent / 보냄 — self#%s\n' "$(seq_of)" ;;
  room|teamchat) if [ "$sub" = say ]; then printf 'sent / 보냄 — team#%s\n' "$(seq_of)"; else printf '%s\n' "$BODY"; fi ;;
  locker) case $sub in
      get) field path ;;
      rm) printf '%s\n' 'moved to trash / 휴지통으로 옮겼어 (30일 뒤 지워져요 — 되살리기는 앱 팀 보관함 휴지통에서)' ;;
      *) printf '%s\n' "$BODY" ;;
    esac ;;
  *) printf '%s\n' "$BODY" ;;
esac
exit 0

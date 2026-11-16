"""교훈 예산 — task send 가 지시 글과 낱말이 겹치는 교훈만 글자 예산 안에서 붙이게(eta-bot 메모리 글자 한도에서 배움, 2026-10-31).
Lesson budget: attach only the lessons that share words with the instruction, within a character budget.

교훈을 지시마다 통째로 붙이니 조사 지시 하나에 Supabase·adb 교훈 22줄(3.3천 자)이 따라갔다(docs/research/2026-10-31-eta-bot-agent.md 1절).
새 의존성 없이 낱말 겹침만 — 한글은 끝 조사·어미를 떼고 앞부분이 같으면 같은 말로 본다. 여러 교훈에 두루 나오는 낱말은 아무것도 가르지 못해 뺀다.
놓친 교훈은 send 가 '그 일이면 읽어: <파일>' 한 줄로 남긴다. 정리꾼(scripts/tidy)도 같은 잣대로 '붙었을 교훈'을 센다.
"""
import re

BUDGET = 1500   # 교훈 칸 글자 예산(머리 포함) — 실측 근거는 docs/plans/2026-10-31-lesson-budget.md

_HANGUL = re.compile(r'[가-힣]+')
_ASCII = re.compile(r'[a-z][a-z0-9_]*')
# 길이 순으로 — 긴 것부터 뗀다
_TAIL = sorted('째 들 에서는 으로는 에서 으로 까지 부터 처럼 보다 에게 한테 하고 이랑 이나 라도 마다 하면 해서 하는 '
               '은 는 이 가 을 를 에 의 도 만 로 과 와 랑 엔 론 고 면 며 서 한 할 된 될 게 지 기 다'.split(), key=len, reverse=True)
# 지시마다 나오는 말 — 이 낱말이 겹쳤다고 관련 교훈은 아니다
_STOP = set('작업 확인 고치 고쳐 수정 정리 다시 먼저 바로 그대로 하나 사용자 참모 지시 프로젝트 이번 다음 지금 때문 경우 '
            '있는 없는 같은 위해 대신 처음 모두 전부 직접 실제 그냥 해줘 하기 보기 만들 추가 기능 내용 '
            # 앱 일 지시 제목에 두루 나와 교훈을 가르지 못한 말(10-17~31 send 477건 실측)
            '화면 코드 요청 읽기 서버 이름 에서 으로 다른 없음 없이 전체 목록 말고 단계 그대 경로 누르 보내 파일 저장 시험 세션 카드 오늘'.split()) | \
        set('the and or for with to of in on at is it be by as an if no not from this that'.split())


def _stem(w):
    for _ in range(2):
        t = next((t for t in _TAIL if w.endswith(t) and len(w) - len(t) >= 2), None)
        if not t:
            break
        w = w[:-len(t)]
    return w


def words(text):
    """글의 낱말 줄기 — 두 글자 이상, 흔한 말 뺌"""
    t = text.lower()
    out = {_stem(w) for w in _HANGUL.findall(t)} | set(_ASCII.findall(t))
    return {w for w in out if len(w) >= 2 and w not in _STOP}


def _same(a, b):
    if a == b:
        return True
    if not (_HANGUL.fullmatch(a) and _HANGUL.fullmatch(b)):
        return False  # 영어는 낱말째만(pr ↔ prod 가 같은 말이 되지 않게)
    s, l = (a, b) if len(a) <= len(b) else (b, a)
    return len(s) >= 3 and l.startswith(s)  # 두 글자는 같을 때만(로그 ↔ 로그인)


def _hits(line_words, text_words):
    """겹친 점수 — 두 글자 말은 1점, 세 글자 넘는 말(브라우저·supabase·adb)은 2점. MIN 이상이어야 관련.
    두 글자 말 하나는 우연이 많았다(따로·자동·빌드 — 10-31 실측)"""
    return sum(1 if len(w) < 3 else 2 for w in line_words if any(_same(w, x) for x in text_words))


MIN = 2


def overlap(a, b):
    return _hits(a, b) > 0


def pick(items, text, budget=BUDGET, cost=len):
    """items = [(칸, 교훈 줄)] → (붙일 것, 자를 것). 겹친 점수가 높은 것부터 예산을 채우고, 고른 건 원래 순서로.
    점수가 MIN 아래면 예산이 남아도 자른다"""
    ws = [words(line) for _, line in items]
    df = {}
    for w in set().union(*ws) if ws else ():
        df[w] = sum(1 for s in ws if w in s)
    common = max(3, len(items) / 4)  # 이보다 많은 교훈에 나오는 낱말은 가르지 못한다
    tw = words(text)
    score = [_hits({w for w in s if df[w] <= common}, tw) for s in ws]
    order = sorted((i for i in range(len(items)) if score[i] >= MIN), key=lambda i: (-score[i], i))
    left, keep = budget, set()
    for i in order:
        c = cost(items[i][1])
        if c <= left:
            keep.add(i)
            left -= c
    return [x for i, x in enumerate(items) if i in keep], [x for i, x in enumerate(items) if i not in keep]

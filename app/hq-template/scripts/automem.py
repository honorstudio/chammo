"""Auto memory — rules from what the user keeps repeating, stronger when broken again, per-assistant memory, kept tidy (ADR 0032).
알아서 기억 — 사용자가 되풀이한 말은 규칙으로, 또 어기면 단계를 올리고, 참모마다 칸을 나눈다. scripts/memory 가 부르는 모듈(직접 실행하지 않는다).
자리: <데이터>/memory/ — rules.json(장부) · common.md(공통 규칙) · orch/<기본 이름>/MEMORY.md(그 참모만) · log.jsonl · _archive/
단계: 1 적어 둠(칸 파일·교훈) → 2 늘 실림(매 지시 훅·send 늘 붙임) → 3 끝내기 전 검사(CHECKS 중 하나를 켬)"""
import datetime, importlib.machinery, importlib.util, json, os, re, secrets, sys

HERE = os.path.dirname(os.path.abspath(__file__))  # 링크(개인 HQ scripts/)로 불렸으면 그 폴더 — 옆의 task 가 그 HQ 것
CHECKS = ('english', 'shots')  # 끝내기 전 검사 — 재발이 제일 많던 둘(11-16 점검 1·2·4위)만. 새 검사는 코드로 더한다
PIN_MAX, PIN_CHARS = 5, 600   # 2단계 줄 상한 — 매 지시에 붙는다
# 결제·승인·권한을 바꾸는 말은 저절로 안 넣는다 — 교훈 거름(task RISKY_LESSON)과 같은 낱말
RISKY = re.compile(r"결제|환불|과금|운영|프로덕션|배포|마이그|승인|허락|허용|권한|묻지\s*말|묻지\s*않|안\s*묻|확인\s*없이|머지|삭제|지워|발송|관문|카드|"
                   r"payment|billing|refund|charge|production|\bprod\b|deploy|migrat|approv|permission|allow|merge|push|"
                   r"without asking|don'?t ask|bypass|skip", re.I)
MARK = re.compile(r'\s*<!-- (r-[0-9a-f]{4,8}) -->\s*$')
_TASK = {}


class Risky(Exception):
    """결제·승인·권한 말 — 보류 장부에만 올렸다(사람 확인 뒤 apply)"""
    def __init__(self, rule):
        super().__init__(rule['text'])
        self.rule = rule


def data_dir():
    env = os.environ.get('CHAMMO_HOME', '').strip()
    if env:
        return os.path.expanduser(env)
    home = os.path.expanduser('~')
    new, old = os.path.join(home, '.chammo'), os.path.join(home, '.honor-orchestrator')
    return old if not os.path.isdir(new) and os.path.isdir(old) else new


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            v = json.load(f)
        return v if isinstance(v, type(default)) else default
    except (OSError, ValueError):
        return default


def cfg_of(data):
    return read_json(os.path.join(data, 'config.json'), {})


def en(data):
    return cfg_of(data).get('language') == 'en'


def T(data, ko, eng):
    return eng if en(data) else ko


def mem(data, *p):
    return os.path.join(data, 'memory', *p)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def write(path, text):
    """옆에 다 쓰고 바꿔 끼운다 — 훅이 반쯤 쓴 파일을 읽지 않게"""
    path = os.path.realpath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f'{path}.{os.getpid()}.{secrets.token_hex(3)}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, path)


def read(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except OSError:
        return ''


def load(data):
    st = read_json(mem(data, 'rules.json'), {})
    for k, v in (('rules', []), ('seen', {}), ('asked', {})):
        if not isinstance(st.get(k), type(v)):
            st[k] = v
    return st


def save(data, st):
    write(mem(data, 'rules.json'), json.dumps(st, ensure_ascii=False, indent=1) + '\n')


def log(data, rec):
    os.makedirs(mem(data), exist_ok=True)
    rec = {'ts': now(), **rec}
    with open(mem(data, 'log.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    return rec


def new_id(st, prefix='r'):
    have = {r.get('id') for r in st['rules']}
    while True:
        i = f'{prefix}-{secrets.token_hex(2)}'
        if i not in have:
            return i


def parse_scope(scope):
    """'common' | 'orch:<기본 이름>' | 'project:<이름>' → (종류, 이름)"""
    if scope == 'common':
        return 'common', ''
    kind, _, name = (scope or '').partition(':')
    if kind in ('orch', 'project') and name.strip() and '/' not in name and '\\' not in name and name not in ('.', '..'):
        return kind, name.strip()
    raise ValueError(f'scope: common | orch:<name> | project:<name> — got {scope!r}')


def find(st, rid):
    r = next((r for r in st['rules'] if r.get('id') == rid), None)
    if not r:
        raise KeyError(f'no rule {rid}')
    return r


def active(st):
    return [r for r in st['rules'] if not r.get('undone') and not r.get('pending')]


# ── 칸에 적기·빼기 ──

def _task(data):
    """교훈 쓰기는 task 가 주인 — 옆의 task 를 모듈로 읽는다(데이터 폴더마다 한 번. task 가 이 모듈을 import 해도 여기선 늦게 읽어 고리가 안 생긴다)"""
    if data not in _TASK:
        old = os.environ.get('CHAMMO_HOME')
        os.environ['CHAMMO_HOME'] = data
        try:
            ld = importlib.machinery.SourceFileLoader(f'task_{len(_TASK)}', os.path.join(HERE, 'task'))
            m = importlib.util.module_from_spec(importlib.util.spec_from_loader(ld.name, ld))
            if HERE not in sys.path:
                sys.path.insert(0, HERE)
            ld.exec_module(m)
        finally:
            if old is None:
                os.environ.pop('CHAMMO_HOME', None)
            else:
                os.environ['CHAMMO_HOME'] = old
        _TASK[data] = m
    return _TASK[data]


def file_of(data, kind, name):
    return mem(data, 'common.md') if kind == 'common' else mem(data, 'orch', name, 'MEMORY.md')


def head_of(data, kind):
    if kind == 'common':
        return T(data, '# 공통 규칙 — 사용자가 되풀이해서 저절로 생긴 것(scripts/memory, 되돌리기 memory undo <id>)',
                 '# Shared rules — made automatically from what the user kept repeating (scripts/memory; undo: memory undo <id>)')
    return T(data, '## 규칙 — 사용자가 되풀이해서 저절로 생긴 것', '## Rules — made automatically from what the user kept repeating')


def _with_line(body, head, line):
    """head 칸 끝에 line — 칸이 없으면 끝에 만든다"""
    ls = body.rstrip('\n').split('\n') if body.strip() else []
    i = next((k for k, l in enumerate(ls) if l.strip() == head), None)
    if i is None:
        if ls:
            ls.append('')
        ls += [head, line]
    else:
        j = next((k for k in range(i + 1, len(ls)) if ls[k].startswith('#')), len(ls))
        while j > i + 1 and not ls[j - 1].strip():
            j -= 1
        ls.insert(j, line)
    return '\n'.join(ls) + '\n'


def _without_id(body, rid):
    ls = body.split('\n')
    keep = [l for l in ls if not (MARK.search(l) and MARK.search(l).group(1) == rid)]
    return '\n'.join(keep), len(keep) != len(ls)


def place(data, rule):
    kind, name = parse_scope(rule['scope'])
    if kind == 'project':
        t = _task(data)
        t.add_lesson(name, rule['text'])
        return
    path = file_of(data, kind, name)
    write(path, _with_line(read(path), head_of(data, kind), f"- {rule['text']} <!-- {rule['id']} -->"))


def unplace(data, rule):
    kind, name = parse_scope(rule['scope'])
    if kind == 'project':
        t = _task(data)
        ls = t.lesson_skill
        with ls.lessons_lock(t.LESSONS):
            path = os.path.join(t.LESSONS, f'{name}.md')
            text, gone = ls.remove_lines(ls._read(path), [rule['text']])
            if gone:
                ls._write(path, text)
                ls._unmirror(t.lesson_env(), name, gone)
        return
    path = file_of(data, kind, name)
    text, hit = _without_id(read(path), rule['id'])
    if hit:
        write(path, text)


# ── 장부 ──

def notice(data, rule):
    """맡은 참모가 사용자에게 전할 한 줄"""
    return T(data, f"'{rule['text']}' 를 규칙으로 넣었어({rule['id']}) — 되돌리려면 말해",
             f"Added '{rule['text']}' as a rule ({rule['id']}) — say so to undo")


def add(data, scope, text, lines=(), hand=None, level=None, why='', said=(), topic=None, loaded=False):
    """규칙 하나 — 칸에 적고(사람이 쓴 규칙이면 장부에만, 2단계부터) 묶음의 줄은 본 줄로. 결제·승인 말이면 Risky(보류)"""
    parse_scope(scope)
    text = ' '.join((text or '').split())
    if not text:
        raise ValueError('empty rule')
    st = load(data)
    rule = {'id': new_id(st), 'text': text, 'scope': scope, 'level': level or (2 if hand else 1), 'check': None,
            'created': now(), 'ups': [], 'lines': list(lines), 'said': list(said)[:8]}
    if hand:
        rule['hand'] = hand
    if why:
        rule['why'] = why
    if topic:
        rule['topic'] = topic
    if loaded:
        rule['loaded'] = True  # 사람이 쓴 글이 이미 매 지시에 실린다 — 2단계 줄로 또 붙이지 않는다
    for u in lines:
        st['seen'][u] = now()[:10]
    if RISKY.search(text) and not hand:
        rule['pending'] = True
        st['rules'].append(rule)
        save(data, st)
        log(data, {'action': 'pending', 'id': rule['id'], 'scope': scope, 'text': text})
        raise Risky(rule)
    if not hand:
        place(data, rule)
    st['rules'].append(rule)
    save(data, st)
    log(data, {'action': 'add', 'id': rule['id'], 'scope': scope, 'text': text, 'hand': hand})
    return rule, notice(data, rule)


def apply(data, rid):
    """보류한 규칙을 사람이 좋다고 한 뒤 넣는다"""
    st = load(data)
    r = find(st, rid)
    if not r.get('pending'):
        return r
    place(data, r)
    r.pop('pending', None)
    r['applied'] = now()
    save(data, st)
    log(data, {'action': 'apply', 'id': rid})
    return r


def undo(data, rid):
    st = load(data)
    r = find(st, rid)
    if r.get('undone'):
        return r
    if not r.get('hand') and not r.get('pending'):
        unplace(data, r)
    r['undone'] = now()
    save(data, st)
    log(data, {'action': 'undo', 'id': rid})
    return r


def up(data, rid, check=None, lines=(), said=()):
    """또 나온 말 — 한 단계 올린다. 3단계는 맞는 검사가 있을 때만(없으면 2에 머물고 그렇다고 알린다)"""
    st = load(data)
    r = find(st, rid)
    for u in lines:
        st['seen'][u] = now()[:10]
    r['ups'].append(now())
    r['lines'] = list(dict.fromkeys(r.get('lines', []) + list(lines)))
    r['said'] = (r.get('said', []) + list(said))[-8:]
    msg = ''
    if r['level'] < 2:
        r['level'] = 2
        msg = T(data, f"'{r['text']}' 를 또 들어서 늘 실리는 자리로 올렸어({rid})", f"Heard '{r['text']}' again — it now rides on every prompt ({rid})")
    elif r['level'] >= 3 and r.get('check'):
        msg = T(data, f"'{r['text']}' 를 또 들었어 — 이미 끝내기 전 검사({r['check']}) 단계야({rid})", f"Heard '{r['text']}' again — already at the {r['check']} check ({rid})")
    elif check in CHECKS:
        r['level'], r['check'] = 3, check
        msg = T(data, f"'{r['text']}' 를 또 들어서 끝내기 전 검사({check})를 켰어({rid})", f"Heard '{r['text']}' again — turned on the {check} check before finishing ({rid})")
    else:
        r['nocheck'] = now()
        msg = T(data, f"'{r['text']}' 를 또 들었는데 맞는 검사가 없어 늘 실림 단계에 둬({rid}) — 새 검사가 필요하면 앱 담당에게",
                f"Heard '{r['text']}' again but no check fits — kept on every prompt ({rid}); a new check needs app work")
    save(data, st)
    log(data, {'action': 'up', 'id': rid, 'level': r['level'], 'check': r.get('check')})
    return r, msg


def raise_group(data, cid, check=None):
    """scan 의 [또] 묶음 하나를 올린다 — 장부 규칙이면 up, 사람이 쓴 규칙이면 장부에 그 단계로 올린(hand) 뒤 up.
    check: None = 주제의 검사(있으면), 'none' = 검사 없이"""
    last = read_json(mem(data, 'last-scan.json'), {})
    m = last.get('meta', {}).get(cid)
    if not m:
        raise KeyError(f'no again group {cid} in the last scan — run scripts/memory scan again')
    if m.get('raised'):
        r = find(load(data), m['raised'])
        return r, T(data, f"{cid} 는 이미 올렸어({r['id']})", f"{cid} was already raised ({r['id']})")
    g = resolve(data, cid)
    chk = None if check == 'none' else check or (TOPIC.get(m.get('topic')) or {}).get('check')
    rid = m.get('rule')
    if not rid:
        rule, _ = add(data, 'common', m['text'], lines=g['lines'], said=g['said'], hand=f"{m['file']}:{m['line']}", level=m['level'],
                      topic=m['topic'], loaded=m['level'] >= 2)
        rid, g = rule['id'], {'lines': [], 'said': []}
    out = up(data, rid, check=chk, lines=g['lines'], said=g['said'])
    m['raised'] = rid  # 같은 묶음을 두 번 부르면 두 칸 오르거나 규칙이 둘 생겼다
    write(mem(data, 'last-scan.json'), json.dumps(last, ensure_ascii=False))
    return out


def set_level(data, rid, n, check=None):
    st = load(data)
    r = find(st, rid)
    n = max(1, min(3, int(n)))
    if n == 3 and (check or r.get('check')) not in CHECKS:
        raise ValueError(f'level 3 needs --check {"|".join(CHECKS)}')
    r['level'] = n
    r['check'] = (check or r.get('check')) if n == 3 else None
    save(data, st)
    log(data, {'action': 'level', 'id': rid, 'level': n, 'check': r['check']})
    return r


def skip(data, lines, why=''):
    st = load(data)
    for u in lines:
        st['seen'][u] = now()[:10]
    save(data, st)
    log(data, {'action': 'skip', 'lines': len(list(lines)), 'why': why})


def check_on(data, check, me=None):
    """그 검사가 켜졌나 — 3단계 규칙 중 공통이거나 me(orch:<이름>)인 것"""
    return any(r.get('level') == 3 and r.get('check') == check and (r['scope'] == 'common' or (me and r['scope'] == me)) for r in active(load(data)))


def pinned(data, me=None):
    """2단계 이상 규칙 줄 — 참모·HQ 세션(me = orch:<이름>)은 공통 + 자기 칸, 프로젝트(me = project:<이름>)는 공통 + 그 프로젝트"""
    out, size = [], 0
    for r in active(load(data)):
        if r.get('level', 1) >= 2 and not r.get('loaded') and (r['scope'] == 'common' or r['scope'] == me):
            if len(out) >= PIN_MAX or size + len(r['text']) > PIN_CHARS:
                break
            out.append(r['text'])
            size += len(r['text'])
    return out


# ── 사람 말 뽑기·묶기(scan) ──

_ROSTER = []


def roster():
    """이름표 스크립트(orch-roster)를 모듈로 — 참모 이름·HQ 폴더·프로젝트 가르기 규칙을 앱·이름표와 같게"""
    if not _ROSTER:
        ld = importlib.machinery.SourceFileLoader('orch_roster', os.path.join(HERE, 'orch-roster'))
        m = importlib.util.module_from_spec(importlib.util.spec_from_loader(ld.name, ld))
        ld.exec_module(m)
        _ROSTER.append(m)
    return _ROSTER[0]


def launch_key(p):
    return re.sub(r'[^A-Za-z0-9]', '-', p)


SKIP = re.compile(r'^\s*\[(?:앱|app|App|스페이스|Space)\]|<pasted_content|^\s*##\s|<cross-session-message|<task-notification|<command-name>|<local-command|<bash-(?:input|stdout|stderr)|^\s*/[a-z]')
REF = re.compile(r'#(?:img|file|chat|task|goal|sel|area)\d+(?:\s+"[^"]*")?(?:\s+box=\S+)?|\[참조 [^\]]*\]|\(원본 "[^"]*"\)')
# 선호·꾸중·지시 꼴 — 이 꼴만 규칙 후보로 본다(일 지시·잡담을 거른다). 영어 사용자 말투도 몇 개
DIRECTIVE = re.compile(r'지\s*마(?:라|요|세요)?(?:\s|$|[.!?~])|하지\s*말|말고|말자|말라|마라|좀|왜|또\s|또$|자꾸|맨날|항상|(?:^|\s)늘\s|절대|제발|싫|했잖|몇\s*번|계속|아직도|여전히|안\s*돼|금지|무조건|'
                       r'해야지|하라고|하라니|말랬|그만|앞으로|다음부터|기억해|명심|규칙|'
                       r'맞(?:아|음|냐|나)\s*\?|안\s*(?:됨|되|돼|고쳐|바뀌)|그대로(?:인|네|임|야)|바뀐\s*게\s*없|확인\s*(?:안|한\s*거)|'
                       r"\b(?:always|never|stop|again|don'?t|do not|keep|please)\b", re.I)
LONG = 140
# 흔히 되풀이되는 주제(11-16 점검 9갈래) — said = 사람 말 꼴(지시 꼴이 아니어도 줍는다), rule = 이미 적힌 규칙 줄 꼴, check = 3단계 검사.
# 첫 판(11-16)은 이 짝짓기를 판단 세션에 맡겼다가 '이미 규칙 있음 = 넘김'으로 끝났다 — 짝짓기는 코드가 하고 판단은 '정말 그 주제인가'만
TOPICS = (
    ('korean', '한국말로', 'english',
     r'한국말|한글로|한글\s*(?:좀|써|답)|영어로\s*(?:답|쓰|말|씀|나와)|영어\s*(?:쓰지|섞|좀|말고)|왜\s*영어|\b(?:reply|answer|respond|talk) in (?:my language|korean)\b|\bstop (?:using|writing) english',
     r'전부 한글|한국말로|in (?:the user.s|their) language'),
    ('done', '했다는데 안 됨·확인 안 함', 'shots',
     r'(?:된|쏜|보낸|올린|고친|확인한|작동하는)\s*(?:거|게)\s*맞|확인\s*(?:안\s*하|안했|한\s*거|하고\s*말)|아무것도\s*안?\s*바뀐|바뀐\s*게\s*없|바뀐게\s*없|\bdid you (?:check|test|verify)',
     r'"했다"는 증거가 아니다|“했다”는 증거|is not proof|우기지 말고 확인'),
    ('still', '고쳤다던 버그 그대로', 'shots',
     r'여전히\s*(?:안|이|그|있|똑)|아직도\s*(?:안|그|이|못)|아직\s*(?:안|못)\s*고쳐|안\s*고쳐|못\s*고친|그대로(?:네|임|잖|인데)|또\s*이\s*지랄|\bstill (?:broken|not|there)',
     r'검증이 빌드보다 먼저|고치면 다시|verif\w*.{0,20}before'),
    ('sonnet', '글은 소넷 medium', None,
     r'(?:글|텍스트|문구|말|카피).{0,20}(?:소넷|sonnet)|(?:소넷|sonnet).{0,12}(?:미디엄|미디업|medium|시켜)|(?:오푸스|오퍼스|opus)가\s*(?:만들|쓴)',
     r'소넷 medium 이 쓴다|written by Sonnet'),
    ('text', '글자 많음·설명 붙이지 마', None,
     r'설명.{0,8}(?:붙이지|빼|없애|줄여)|글자.{0,4}(?:많|줄여)|텍스트.{0,4}(?:많|줄여)|구구절절|글이\s*너무|말이\s*너무\s*길|\btoo (?:much text|wordy)',
     r'글자가 많은 화면|글자는 읽을 것만|less text on screen'),
    ('ask', '그만 물어봐·추천대로', None,
     r'묻지\s*마|묻지말|물어보지\s*마|물어보지말|그만\s*물어|물어볼\s*필요\s*없|하지도\s*않고\s*물|왜\s*(?:나한테\s*)?물어|\b(?:stop asking|don.?t ask)',
     r'웬만한 건 네가 정한다|묻지 않기|그만 물어보|You decide most things'),
    ('stop', '멈추지 말고 완주', None,
     r'왜\s*멈|멈추지\s*마|멈추지말|멈추는\s*건\s*안|멈추는건\s*안|자꾸\s*멈|멈춰\s*있|멈춰있|\bwhy (?:did (?:it|you) )?stop',
     r'멈춤 대신|멈추는 건 절대|완주 지시|never stop'),
    ('user', '사람한테 시키지 마', None,
     r'니가\s*(?:클릭|눌러|켜|열어)\s*하?라고|나한테\s*(?:시키|하라고|클릭)|내가\s*왜\s*(?:해|눌|클릭)|껐다\s*켜(?:라고|달라)|\bwhy (?:me|should i)\b',
     r'가서 쳐 줘|껐다 켜기 부탁|go to that session and type'),
    ('route', '엉뚱한 참모에 카드·답', None,
     r'(?:비서|참모)(?:한테|에게)\s*(?:카드가?|답이?)\s*(?:뜸|떠|가|와)|엉뚱한\s*참모|wrong assistant',
     r'참모가 여럿일 때|who handles what'),
)
# 적힌 줄이 제목·색인 링크라 규칙 문장이 아닐 때 장부에 적는 한 줄(사람 말 요약) — 11-16 '참모가 여럿일 때 — 누가 무엇을'이 규칙으로 실렸다
TOPIC_TEXT = {
    'korean': ('사용자에게 보이는 글은 끝까지 사용자 말(한국말)로 쓴다', "Everything the user sees is written in the user's language, to the end"),
    'done': ("'했다'로 끝내지 않는다 — 확인한 증거를 같이 적는다", "Don't stop at 'done' — say what you checked, with proof"),
    'still': ('고쳤다고 하기 전에 사용자가 본 화면으로 다시 확인한다', 'Before saying it is fixed, check again on the screen the user saw'),
    'sonnet': ('사람이 읽는 글은 소넷 medium 이 쓴다', 'Text people read is written by Sonnet medium'),
    'text': ('화면 글자는 읽을 것만 — 설명 줄을 붙이지 않는다', 'On screen, only text worth reading — no explanation lines'),
    'ask': ('되돌리기 쉬운 건 묻지 말고 추천안으로 정한다', 'Decide easy-to-undo things with your pick instead of asking'),
    'stop': ('멈추지 말고 끝까지 간다 — 막히면 바로 알린다', "Don't stop halfway — if blocked, say so right away"),
    'user': ('사람에게 클릭·껐다 켜기를 시키지 않는다', "Don't ask the user to click or restart things for you"),
    'route': ('카드·답은 그 일을 맡은 참모에게 가게 한다', 'Cards and replies go to the assistant who owns that work'),
}
TOPIC = {k: {'key': k, 'label': lb, 'check': c, 'said': re.compile(s, re.I), 'rule': re.compile(w, re.I),
             'text_ko': TOPIC_TEXT[k][0], 'text_en': TOPIC_TEXT[k][1]} for k, lb, c, s, w in TOPICS}
NOT_RULE = re.compile(r'^\s*#|\[[^\]]*\]\([^)]*\)')  # 마크다운 제목·링크 줄 — 규칙 문장이 아니다


def topic_of(text):
    return next((k for k, t in TOPIC.items() if t['said'].search(text or '')), None)


def rule_topic(r):
    """장부 규칙의 주제 — 적어 둔 topic, 없으면 글로 짐작(말 꼴 → 규칙 줄 꼴)"""
    t = r.get('text', '')
    return r.get('topic') or topic_of(t) or next((k for k, x in TOPIC.items() if x['rule'].search(t)), None)


def rule_files(data, root):
    """사람이 이미 써 둔 규칙 파일 [(경로, 늘 실리나)] — 전역·HQ CLAUDE.md(와 @ 로 싣는 안내문)·CLAUDE.local.md·HQ 공통 메모리"""
    R = roster()
    hq = R.fwd(R.hq_path(cfg_of(data), data, os.environ)).rstrip('/')
    claude = os.path.dirname(os.path.abspath(root))
    out = [os.path.join(claude, 'CLAUDE.md'), os.path.join(hq, 'CLAUDE.md')]
    out += [os.path.join(hq, m) for m in re.findall(r'^@(\S+\.md)\s*$', read(out[1]), re.M)]
    out += [os.path.join(hq, n) for n in ('CHAMMO.ko.md', 'CHAMMO.md', 'CLAUDE.local.md')]
    files = [(p, True) for p in dict.fromkeys(out)]
    for key in dict.fromkeys((launch_key(hq), launch_key(R.fwd(os.path.realpath(hq)).rstrip('/')))):
        d = os.path.join(root, key, 'memory')
        names = sorted(os.listdir(d)) if os.path.isdir(d) else []
        files += [(os.path.join(d, n), n == 'MEMORY.md') for n in names if n.endswith('.md')]
    return [(p, loaded) for p, loaded in files if os.path.isfile(p)]


def written_rule(files, key, eng=False):
    """그 주제의 이미 적힌 규칙 줄 하나 — 늘 실리는 파일이 먼저. 제목·링크 줄이면 규칙 문장은 주제 요약으로"""
    rx = TOPIC[key]['rule']
    for p, loaded in sorted(files, key=lambda f: not f[1]):
        for n, line in enumerate(read(p).splitlines(), 1):
            if rx.search(line):
                if NOT_RULE.search(line):
                    return {'file': p, 'line': n, 'text': TOPIC[key]['text_en' if eng else 'text_ko'], 'level': 2 if loaded else 1}
                text = re.sub(r'^\s*(?:[-*#]+|\d+\.)\s*', '', line).replace('**', '').strip()
                return {'file': p, 'line': n, 'text': text[:160], 'level': 2 if loaded else 1}
    return None


TMP =('/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/')


def _content(row):
    if row.get('type') == 'user':
        c = (row.get('message') or {}).get('content')
    elif row.get('type') == 'attachment' and isinstance(row.get('attachment'), dict) and row['attachment'].get('type') == 'queued_command':
        a = row['attachment']
        if (a.get('origin') or {}).get('kind') != 'human':
            return None
        c = a.get('prompt')
    else:
        return None
    if isinstance(c, list):
        c = ' '.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
    return c if isinstance(c, str) else None


def clean(text):
    t = text.split('(넘긴 남의 말')[0].split('(Forwarded message')[0]
    return ' '.join(REF.sub(' ', t).split())[:300]


def _parse_ts(v):
    try:
        t = datetime.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        return t if t.tzinfo else t.replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return None


def human_lines(data, root=None, days=30, now_=None):
    """[{uuid, ts, text, sid, who}] — 최근 days 일 사람이 직접 친 선호·꾸중·지시 꼴 줄. who = orch:<이름> | project:<이름> | hq"""
    root = root or os.path.expanduser('~/.claude/projects')
    cfg = cfg_of(data)
    R = roster()
    bases = R.bases_of(cfg)
    hq = R.fwd(R.hq_path(cfg, data, os.environ)).rstrip('/')
    hq_keys = {launch_key(hq), launch_key(R.fwd(os.path.realpath(hq)).rstrip('/'))}
    dev, extras = cfg.get('devRoot') or '', cfg.get('extraProjects') if isinstance(cfg.get('extraProjects'), list) else []
    since = (now_ or datetime.datetime.now(datetime.timezone.utc)) - datetime.timedelta(days=days)
    out = []
    for folder in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        d = os.path.join(root, folder)
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            p = os.path.join(d, f)
            try:
                if not f.endswith('.jsonl') or os.path.getmtime(p) < since.timestamp():
                    continue
                fh = open(p, 'rb')
            except OSError:
                continue
            name, rows = '', []
            with fh:
                for raw in fh:
                    if b'agent-name' in raw:
                        try:
                            name = json.loads(raw).get('agentName') or name
                        except ValueError:
                            pass
                    elif b'"human"' in raw:
                        try:
                            rows.append(json.loads(raw))
                        except ValueError:
                            pass
            in_hq = folder in hq_keys
            base = R.orch_base(name, bases) if in_hq else None
            for row in rows:
                if not isinstance(row, dict) or row.get('isSidechain'):
                    continue
                if row.get('type') == 'user' and ((row.get('origin') or {}).get('kind') != 'human' or (row.get('turnPosition') or {}).get('promptIndex') == 1):
                    continue
                at, raw_text = _parse_ts(row.get('timestamp')), _content(row)
                if not at or at < since or not raw_text or SKIP.search(raw_text):
                    continue
                text = clean(raw_text)
                if (len(text) < 4 or len(text) > LONG or not DIRECTIVE.search(text)) and not (len(text) <= 200 and topic_of(text)):
                    continue  # 긴 글은 일 지시·붙여넣기 — 되풀이하는 선호는 짧다(흔한 주제 꼴은 '한글로'처럼 지시 꼴이 아니어도 줍는다)
                if in_hq:
                    if not base:
                        continue  # HQ 도우미·시험 세션(probe 등) — 사람이 참모에게 한 말만
                    who = f'orch:{base}'
                else:
                    cwd = R.fwd(row.get('cwd') or '')
                    inside = bool(dev) and R.same_dir(cwd, dev) or cwd.startswith(R.fwd(dev).rstrip('/') + '/')
                    if not cwd or (not inside and (any(cwd.startswith(x) for x in TMP) or '/.cache/' in cwd)):
                        continue  # 시험·임시 폴더 세션(devRoot 안이면 그대로)
                    proj = R.project_of(cwd, dev, extras) if dev else None
                    if not proj:
                        continue
                    who = f'project:{proj}'
                out.append({'uuid': row.get('uuid') or f"{f}:{len(out)}", 'ts': at.isoformat(timespec='seconds'), 'text': text,
                            'sid': row.get('sessionId') or f[:-6], 'who': who})
    return dedupe(out)


def dedupe(lines):
    """같은 글을 10분 안에 또 보낸 건(다시 보내기·여러 참모에게 한꺼번에) 한 번으로"""
    out, last = [], {}
    for l in sorted(lines, key=lambda l: l['ts']):
        t = _parse_ts(l['ts'])
        prev = last.get(l['text'])
        last[l['text']] = t
        if prev and (t - prev).total_seconds() < 600:
            continue
        out.append(l)
    return out


PIC = re.compile(r'\[Image #\d+\]|\.(?:png|jpe?g|gif|webp|heic)\b', re.I)
_HANGUL = re.compile(r'[가-힣]+|[a-z][a-z0-9_]{2,}')
# 끝 조사·어미 — 떼고 조각을 낸다('미디엄으로'·'텍스트를' 이 '미디엄'·'텍스트'와 같은 말이 되게). 긴 것부터
_TAIL = sorted('에서는 으로는 에서 으로 까지 부터 처럼 에게 한테 이랑 라고 라니 은 는 이 가 을 를 에 의 도 만 로 과 와 랑 엔 고 면 서 야 지 요 좀'.split(), key=len, reverse=True)


def _stem(w):
    t = next((t for t in _TAIL if w.endswith(t) and len(w) - len(t) >= 2), None)
    return w[:-len(t)] if t else w


def grams(text):
    """두 글자 조각 — 한글 낱말은 끝 조사를 떼고 글자 둘씩, 영어는 세 글자 넘는 낱말째"""
    out = set()
    for w in _HANGUL.findall(text.lower()):
        if w[0] >= '가':
            w = _stem(w)
            out |= {w[i:i + 2] for i in range(len(w) - 1)} if len(w) > 1 else set()
        else:
            out.add(w)
    return out


def similar(a, b):
    s = len(a & b)
    return s >= 2 and s / max(1, min(len(a), len(b))) >= 0.5


def group(lines):
    """비슷한 줄끼리 묶음 [[줄…]] — 묶음마다 첫 줄(씨앗)과 견준다. 줄끼리 이어 붙이면(A~B~C) 51줄짜리 덩어리가 생겼다(11-16 실데이터).
    여기저기 나오는 조각(해줘·이거)은 근거가 못 된다"""
    gs = [grams(l['text']) for l in lines]
    df = {}
    for g in gs:
        for x in g:
            df[x] = df.get(x, 0) + 1
    common = max(5, len(lines) * 0.03)
    gs = [{x for x in g if df[x] <= common} for g in gs]
    seeds, out = [], []
    for i in sorted(range(len(lines)), key=lambda i: lines[i]['ts']):
        best = max(((len(gs[i] & s), k) for k, s in enumerate(seeds) if similar(gs[i], s)), default=None)
        if best:
            out[best[1]].append(lines[i])
        else:
            seeds.append(gs[i])
            out.append([lines[i]])
    return out


def _cid(lines, prefix='c'):
    import hashlib
    return prefix + hashlib.sha1('\n'.join(sorted(l['uuid'] for l in lines)).encode()).hexdigest()[:6]


def _sample(l):
    who = l['who'].split(':', 1)[-1]
    return {'ts': l['ts'][:16].replace('T', ' '), 'who': who, 'text': l['text'][:160]}


def scan(data, root=None, days=45, now_=None, limit=60):
    """새로 들어온(안 본) 사람 말 → {'again': 규칙이 생긴 뒤 또 나온 말(규칙별), 'new': 나머지 새 말 묶음 + 비슷한 옛 말(이웃)}.
    같은 뜻 다른 말(한국말좀 ↔ 영어 왜)은 낱말로 못 묶는다 — 판단하는 예약이 memory find 로 넓혀 센다. 묶음은 이웃까지 센 수(total) 순.
    읽기만 — 다음 add·up·skip·find 가 쓸 last-scan.json·pool.json 만 남긴다"""
    st = load(data)
    lines = human_lines(data, root, days, now_)
    seen = st['seen']
    rules = active(st)
    said = {r['id']: [grams(t) for t in r.get('said', []) + [r['text']]] for r in rules}
    since_rule = {r['id']: _parse_ts(r['ups'][-1] if r.get('ups') else r['created']) or since_never() for r in rules}
    fresh = [l for l in lines if l['uuid'] not in seen]
    topic_rule = {}
    for r in sorted(rules, key=lambda r: r.get('level', 1)):
        if rule_topic(r):
            topic_rule[rule_topic(r)] = r  # 같은 주제 규칙이 둘이면 단계 높은 쪽
    undone = {rule_topic(r) for r in st['rules'] if r.get('undone')}  # 사람이 되돌린 주제는 다시 저절로 올리지 않는다
    files, wrote = None, {}
    again, rest, quiet, by_topic = {}, [], [], {}
    for l in fresh:
        g, at, t = grams(l['text']), _parse_ts(l['ts']), topic_of(l['text'])
        hit = next((r for r in rules if since_rule[r['id']] < at and any(similar(g, x) for x in said[r['id']])), None)
        if not hit and t in topic_rule:
            if since_rule[topic_rule[t]['id']] < at:
                hit = topic_rule[t]
            else:
                quiet.append(l)  # 규칙보다 앞선 말 — '또'도 새 규칙감도 아니다
                continue
        if not hit and t and t not in undone:
            if files is None:
                files = rule_files(data, root or os.path.expanduser('~/.claude/projects'))
            if t not in wrote:
                wrote[t] = written_rule(files, t, en(data))
            if wrote[t]:
                by_topic.setdefault(t, []).append(l)
                continue
        (again.setdefault(hit['id'], []) if hit else rest).append(l)
    out, keep, meta = {'new': [], 'again': [], 'fresh': len(fresh), 'lines': len(lines),
                       'monday': (now_ or datetime.datetime.now(datetime.timezone.utc)).astimezone().weekday() == 0}, {}, {}
    for rid, ls in again.items():
        r = find(st, rid)
        cid = _cid(ls, 'a')
        keep[cid], meta[cid] = ls, {'rule': rid, 'topic': rule_topic(r)}
        out['again'].append({'cid': cid, 'rule': rid, 'topic': rule_topic(r), 'text': r['text'], 'level': r['level'], 'scope': r['scope'], 'n': len(ls),
                             'file': r.get('hand'), 'samples': [_sample(l) for l in ls[-5:]]})
    for t, ls in by_topic.items():
        w = wrote[t]
        cid = _cid(ls, 'w')
        keep[cid], meta[cid] = ls, {'rule': None, 'topic': t, **w}
        out['again'].append({'cid': cid, 'rule': None, 'topic': t, 'label': TOPIC[t]['label'], 'scope': 'common', 'n': len(ls),
                             **w, 'samples': [_sample(l) for l in ls[-5:]]})
    fresh_ids = {l['uuid'] for l in rest}
    old = [(l, grams(l['text'])) for l in lines if l['uuid'] not in fresh_ids]
    for g in group(rest):
        seed = grams(g[0]['text'])
        near = [l for l, x in old if similar(seed, x)]
        allx = g + near
        whos = {l['who'] for l in allx}
        one = next(iter(whos)) if len(whos) == 1 else ''
        cid = _cid(g)
        keep[cid] = allx
        out['new'].append({'cid': cid, 'n': len(g), 'total': len(allx), 'days': len({l['ts'][:10] for l in allx}),
                           'shot': any(PIC.search(l['text']) for l in g), 'fresh_ids': [l['uuid'] for l in g],
                           'scope': one if one.startswith(('orch:', 'project:')) else 'common', 'where': sorted(w.split(':', 1)[-1] for w in whos),
                           'risky': any(RISKY.search(l['text']) for l in allx), 'samples': [_sample(l) for l in g[:3]],
                           'before': [_sample(l) for l in sorted(near, key=lambda l: l['ts'])[-4:]]})
    out['new'].sort(key=lambda c: (c['shot'], -c['total'], -c['days']))  # 그림 붙은 말(버그 신고)은 규칙감이 아니라 뒤로
    out['more'] = max(0, len(out['new']) - limit)
    out['new'] = out['new'][:limit]
    shown = [u for c in out['new'] for u in c.pop('fresh_ids')] + [l['uuid'] for ls in list(again.values()) + list(by_topic.values()) + [quiet] for l in ls]
    write(mem(data, 'last-scan.json'), json.dumps({'fresh': shown, 'meta': meta,
                                                   'groups': {k: [{'uuid': l['uuid'], 'text': l['text']} for l in v] for k, v in keep.items()}}, ensure_ascii=False))
    write(mem(data, 'pool.json'), json.dumps(lines, ensure_ascii=False))
    return out


def find_said(data, pattern, days=None):
    """옛 사람 말에서 찾기(scan 이 남긴 pool) — 같은 뜻 다른 말을 판단하는 쪽이 낱말을 넓혀 센다. pattern = 정규식(대소문자 무시)"""
    lines = read_json(mem(data, 'pool.json'), [])
    rx = re.compile(pattern, re.I)
    hit = [l for l in lines if isinstance(l, dict) and rx.search(l.get('text', ''))]
    cid = _cid(hit, 'f') if hit else ''
    if hit:
        last = read_json(mem(data, 'last-scan.json'), {})
        last.setdefault('groups', {})[cid] = [{'uuid': l['uuid'], 'text': l['text']} for l in hit]
        write(mem(data, 'last-scan.json'), json.dumps(last, ensure_ascii=False))
    whos = sorted({l['who'].split(':', 1)[-1] for l in hit})
    return {'cid': cid, 'n': len(hit), 'days': len({l['ts'][:10] for l in hit}), 'where': whos,
            'scope': (hit[0]['who'] if len({l['who'] for l in hit}) == 1 and hit[0]['who'].startswith(('orch:', 'project:')) else 'common') if hit else '',
            'samples': [_sample(l) for l in sorted(hit, key=lambda l: l['ts'])[-8:]]}


def fresh_lines(data):
    """마지막 scan 이 보여 준 묶음의 새 줄(과 '또' 줄) — 판단을 마치면 skip 으로 본 줄로. 못 보여 준 묶음은 다음 판에 다시 온다"""
    return read_json(mem(data, 'last-scan.json'), {}).get('fresh', [])


def since_never():
    return datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)


def resolve(data, cid):
    """scan 이 준 묶음 번호 → {'lines': 줄 uuid, 'said': 사람이 한 말}"""
    got = read_json(mem(data, 'last-scan.json'), {}).get('groups', {}).get(cid)
    if not got:
        raise KeyError(f'no group {cid} in the last scan — run scripts/memory scan again')
    return {'lines': [x['uuid'] for x in got], 'said': [x['text'] for x in got][-8:]}


# ── 맡은 참모·한 번 묻기·예약 ──

KEEPER = re.compile(r'기억|교훈|규칙|참모\s*앱|memory|lesson|rules|Chammo app', re.I)  # '정리·예약'은 흔한 낱말이라 회사 일 참모('서류 정리')에 걸렸다(11-16)


def set_owner(data, base):
    """공통 기억 알림을 받을 참모(기본 이름)를 정해 둔다 — <데이터>/memory/owner.json(앱 config.json 은 모르는 칸을 저장 때 지운다)"""
    base = (base or '').strip()
    write(mem(data, 'owner.json'), json.dumps({'owner': base, 'at': now()}, ensure_ascii=False) + '\n')
    log(data, {'action': 'owner', 'owner': base})
    return base


def owner(data, scope, agents=None, now_=None):
    """결과 한 줄을 받을 참모의 SendMessage 주소 — 참모 칸은 그 참모, 프로젝트는 최근 7일 그 일을 맡긴 참모,
    공통(과 못 찾은 것)은 정해 둔 참모(owner --set) → 맡은 일에 기억·교훈·규칙·참모 앱이 든 참모 → 기본 이름 참모 → 첫 참모. 참모가 없으면 ''"""
    R, cfg = roster(), cfg_of(data)
    agents = [a for a in (R.live_agents(data) if agents is None else agents) if isinstance(a, dict)]
    bases = R.bases_of(cfg)
    full = {}
    for a in R.hq_orchs(agents, cfg):
        full.setdefault(R.orch_base(a.get('name'), bases), a['name'])
    kind, name = parse_scope(scope)
    if kind == 'orch':
        return full.get(name, name)
    roles = read_json(os.path.join(data, 'orch-roles.json'), {})
    if kind == 'project':
        now_ = now_ or datetime.datetime.now(datetime.timezone.utc)
        guessed = R.guess(agents, roles, R.read_events(os.path.join(data, 'tasks.jsonl')), cfg, now_)
        b = next((b for b, ps in sorted(guessed.items()) if name in ps), None)
        if b:
            return full.get(b, b)
    chosen = str(read_json(mem(data, 'owner.json'), {}).get('owner') or '').strip()
    if chosen in full:
        return full[chosen]
    keeper = next((full[b] for b, r in sorted(roles.items()) if b in full and isinstance(r, dict) and KEEPER.search(str(r.get('role') or ''))), None)
    return keeper or next((full[b] for b in bases if b in full), None) or (sorted(full.values())[0] if full else '')


def stats(data, days=7, now_=None):
    """매주 한 줄 — 새 규칙·올림·영어 다시 쓰기·캡처 없이 닫은 일·지금 규칙 수. 검사가 먹히는지 보는 숫자"""
    now_ = now_ or datetime.datetime.now(datetime.timezone.utc)
    since = now_ - datetime.timedelta(days=days)
    recent = lambda r: (_parse_ts(r.get('ts')) or since_never()) >= since
    logs = [json.loads(l) for l in read(mem(data, 'log.jsonl')).splitlines() if l.strip()]
    logs = [r for r in logs if recent(r)]
    events = roster().read_events(os.path.join(data, 'tasks.jsonl'))
    noshot = sum(1 for e in events if isinstance(e, dict) and e.get('type') == 'done' and e.get('noShot') and recent(e))
    act = active(load(data))
    n = {k: sum(1 for r in logs if r.get('action') == k) for k in ('add', 'up', 'check')}
    lv = {k: sum(1 for r in act if r.get('level') == k) for k in (1, 2, 3)}
    return T(data, f"기억 이번 주: 새 규칙 {n['add']} · 올림 {n['up']} · 영어 다시 쓰기 {n['check']}번 · 캡처 없이 닫은 일 {noshot}건 · 지금 규칙 {len(act)}개(1단계 {lv[1]}·2단계 {lv[2]}·3단계 {lv[3]})",
             f"Memory this week: new rules {n['add']} · raised {n['up']} · English rewrites {n['check']} · closed without a capture {noshot} · rules now {len(act)} (L1 {lv[1]} · L2 {lv[2]} · L3 {lv[3]})")


def ask(data, key, text):
    """서로 다른 말을 하는 규칙처럼 사람이 정할 것 — 열쇠마다 한 번만(처음이면 True). 묻는 건 맡은 참모가 한다"""
    st = load(data)
    if key in st['asked']:
        return False
    st['asked'][key] = now()
    save(data, st)
    log(data, {'action': 'ask', 'key': key, 'text': text})
    return True


ROUTINE, WHEN = 'memory', 'daily 05:30'


def schedule(data, runner=None):
    """매일 판단 예약(소넷 medium) — 한 번만 만든다. 지침은 앱과 같이 바뀌게 scripts/memory guide 가 찍는다"""
    import subprocess
    runner = runner or subprocess.run
    routine = os.path.join(HERE, 'routine')
    py = sys.executable or 'python3'
    r = runner([py, routine, 'list'], capture_output=True, text=True, timeout=120)
    try:
        rows = json.loads(r.stdout or '[]')
    except ValueError:
        rows = []
    rows = rows.get('routines', rows) if isinstance(rows, dict) else rows
    if any(isinstance(x, dict) and x.get('name') == ROUTINE for x in rows):
        return f'{ROUTINE}: already scheduled'
    hq = roster().fwd(roster().hq_path(cfg_of(data), data, os.environ)).rstrip('/')
    job = ('Run `scripts/memory guide` and do exactly what it prints (auto memory: turn what the user keeps repeating into rules). '
           '/ scripts/memory guide 를 돌려 그대로 한다(알아서 기억 — 사용자가 되풀이한 말을 규칙으로).')
    r = runner([py, routine, 'new', ROUTINE, WHEN, job, '--in', hq, '--model', 'sonnet', '--effort', 'medium'], capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise ValueError(f'routine new failed: {(r.stderr or r.stdout).strip()[:300]}')
    return f'{ROUTINE}: scheduled {WHEN} (sonnet medium)'


def guide(data):
    """매일 예약이 읽고 그대로 하는 지침 — 코드와 같이 바뀐다"""
    if en(data):
        return GUIDE_EN
    return GUIDE_KO


GUIDE_KO = r"""알아서 기억 — 매일 한 번. 사용자에게 묻지 않는다(선택지 창 금지). 메모리·CLAUDE.md·교훈 파일을 손으로 고치거나 지우지 않는다 — 전부 scripts/memory 로.

1. `scripts/memory scan` — [또] 이미 있는 규칙(장부든 사람이 쓴 CLAUDE.md·안내문·메모리든 — 짝짓기는 scan 이 해 둔다)이 생긴 뒤 또 나온 말, [새] 새 사람 말 묶음(이웃 = 비슷한 옛 말)이 나온다. 첫 줄에 '오늘 월요일'이 있으면 5번도 한다.
2. **[또] 는 넘기지 않는다 — 올린다.** 규칙이 이미 있다는 건 넘길 이유가 아니라 또 어겼다는 뜻이다(마지막으로 나온 날이 며칠 전이어도 같다). 할 일은 보기 줄이 정말 그 주제인지만 보는 것:
   - 하나라도 그 주제(예: 한국말 = 답을 한국말로 해 달라는 말)면 `scripts/memory raise <묶음>` — 단계·검사는 코드가 고른다(늘 실리는 글이면 검사 단계로, 메모리 파일이면 늘 실림으로).
   - 보기 줄이 전부 다른 얘기일 때만(예: '한글 입력 엔터 버그' 신고) 넘기고, 보고에 그 묶음 번호와 이유를 한 줄 적는다.
   - 코드가 고른 검사가 안 맞으면 바꾼다: `--check english`(한국말로·영어 섞임) · `--check shots`(고쳤다는데 그대로·했다는데 안 됨) · `--check none`(검사 없이 늘 실림에 둔다).
3. [새] 마다: 사용자가 같은 선호·꾸중·지시를 3번 넘게 했나? 이웃 수(옛 말 포함)를 보고, 같은 뜻 다른 말은 `scripts/memory find "<낱말|비슷한말|…>"` 로 넓혀 센다.
   - 일 지시·질문·한 번 난 버그 신고·잡담은 규칙이 아니다 — 넘긴다.
   - 이미 적힌 규칙이 있나 먼저 본다: `scripts/memory list`, HQ 공통 메모리(~/.claude/projects/<HQ 폴더 이름>/memory/), HQ CLAUDE.md·CHAMMO 안내문, ~/.claude/CLAUDE.md 를 grep.
     · 있는데 그 규칙이 생긴 뒤에도 또 했으면 → 넘기지 말고 `scripts/memory add <칸> "<한 줄>" --hand <그 파일> --from <묶음>`(장부에 2단계로 — 올리기)
     · 없으면 → `scripts/memory add <칸> "<규칙 한 줄 — 하라/하지 마 꼴, 60자 안>" --from <묶음>`
   - 칸: 한 참모에게만 한 말 → orch:<참모 기본 이름>, 한 프로젝트 세션에서만 → project:<프로젝트>, 둘 넘게 걸치면 → common. scan 의 '칸 짐작'을 보되 뜻으로 고친다.
   - 종료 3(결제·승인·권한 말)이면 보류된 것 — 맡은 참모에게 "넣을지 사용자에게 물어 줘 — 좋다면 scripts/memory apply <id>" 를 보낸다.
   - 사용자 말이 이미 적힌 규칙과 다른 말이면(숫자·방향이 다름 — 예: 규칙은 '보내라', 말은 '보내기 전에 보여 줘') 규칙을 고치지 말고 5번처럼 `scripts/memory ask` 로 한 번만 묻는다.
4. 다 봤으면 `scripts/memory skip --fresh` — 이번에 보여 준 묶음의 줄만 '본 줄'로(못 보여 준 묶음은 다음 판에 다시 온다).
5. 월요일이면: `scripts/tidy run` 이 있으면 돌린다(안 쓰는 교훈 스킬 보관·겹침 합치기 — 되돌림 tidy restore). 그 첫 줄과 `scripts/memory stats` 한 줄을 공통 맡은 참모에게 보낸다.
   출력의 '비슷한 묶음' 중 서로 다른 말을 하는 규칙이 있으면
   `scripts/memory ask <짧은 영문 열쇠> "[무엇 / 선택지 / 추천]"` — 0 이면 공통 맡은 참모에게 보내고, 1 이면 이미 물은 것이라 넘긴다.
6. 알림: add·raise·up·ask·tidy 가 찍은 마지막 줄을 `scripts/memory owner <칸>` 이 찍은 참모에게 SendMessage(같은 참모에게 가는 줄은 한 메시지로, 첫 줄 머리에 "[기억]").
   참모는 그 줄을 사용자에게 한 줄로 전한다 — 되돌리기는 scripts/memory undo <id>.
7. `scripts/routine report memory ok "<새 규칙 N · 올림 N(raise·up) · 보류 N · 넘김 N묶음 — [또] 를 넘겼으면 그 묶음과 이유>"` — 못 끝냈으면 fail 과 이유.
"""

GUIDE_EN = r"""Auto memory — once a day. Never ask the user (no choice prompts). Never edit or delete memory, CLAUDE.md or lesson files by hand — everything through scripts/memory.

1. `scripts/memory scan` — [again] things said again after a rule existed (ledger rules, and rules a person wrote in CLAUDE.md, the guide or memory — scan pairs them), [new] groups of new user lines (neighbours = similar older lines). If the first line says it is Monday, do step 5 too.
2. **Never skip an [again] — raise it.** A rule already existing is not a reason to skip; it means it was broken again (even if the last time was days ago). Only check that the sample lines really are that topic:
   - if any one is → `scripts/memory raise <group>` — the code picks the level and the check.
   - only if every sample is about something else (e.g. a bug report about typing Korean) skip it, and name the group and why in the report.
   - if the check the code picked is wrong, override it: `--check english` (reply in my language) · `--check shots` ("fixed" but still broken) · `--check none`.
3. For each [new]: did the user say the same preference, complaint or instruction more than twice? Count neighbours; widen with `scripts/memory find "<word|synonym|…>"`.
   - Work requests, questions, one-off bug reports and small talk are not rules — skip them.
   - Check for an existing rule first: `scripts/memory list`, the HQ shared memory (~/.claude/projects/<HQ folder key>/memory/), HQ CLAUDE.md and CHAMMO.md, ~/.claude/CLAUDE.md (grep).
     · exists, and the user said it again after it was written → `scripts/memory add <scope> "<one line>" --hand <that file> --from <group>` (enters the ledger at level 2)
     · none → `scripts/memory add <scope> "<one-line rule — do / don't, under 60 chars>" --from <group>`
   - Scope: said to one assistant only → orch:<assistant base name>; in one project's sessions → project:<project>; across several → common.
   - Exit 3 (payment / approval / permission words) means it is on hold — tell the owner: "ask the user whether to add it — if yes, scripts/memory apply <id>".
   - If what the user said contradicts a written rule (a different number or direction), don't edit the rule — ask once with `scripts/memory ask` as in step 5.
4. When done, `scripts/memory skip --fresh` — marks the lines of the groups shown this run as seen (groups not shown come back next run).
5. On Mondays: run `scripts/tidy run` if it exists (shelves unused lesson skills, merges duplicates — tidy restore undoes). Send its first line and the `scripts/memory stats` line to the shared owner.
   If its similar groups contain rules that contradict,
   `scripts/memory ask <short key> "[what / options / pick]"` — 0: send it to the shared owner; 1: already asked, skip.
6. Notify: send the last line that add/raise/up/ask/tidy printed to the assistant `scripts/memory owner <scope>` prints, with SendMessage (one message per assistant, first line starting "[memory]").
   They pass it on to the user in one line — undo is scripts/memory undo <id>.
7. `scripts/routine report memory ok "<new rules N · raised N (raise/up) · on hold N · skipped N groups — any [again] skipped: which and why>"` — fail with the reason if you could not finish.
"""


# ── 명령줄(scripts/memory) ──

def _opt(a, k, default=None):
    return a[a.index(k) + 1] if k in a[:-1] else default


def _opts(a, k):
    return [a[i + 1] for i, x in enumerate(a[:-1]) if x == k]


def _print_scan(data, r):
    say = (lambda ko, e: e) if en(data) else (lambda ko, e: ko)
    print(say(f"새 사람 말 {r['fresh']}줄(살펴볼 묶음 {len(r['new'])}" + (f", 다음 판으로 {r['more']}" if r.get('more') else '') + f") · 또 나온 말 {len(r['again'])}묶음",
              f"{r['fresh']} new user lines ({len(r['new'])} groups" + (f", {r['more']} left for next run" if r.get('more') else '') + f") · said again: {len(r['again'])}"))
    if r.get('monday'):
        print(say('오늘 월요일 — 지침 5번도', "It's Monday — do step 5 too"))
    for a in r['again']:
        where = a['rule'] or (f"{a['file']}:{a['line']}" if a.get('file') else '')
        print(say(f"[또] {a['cid']} {where}({a['level']}단계, {a.get('topic') or a['scope']}) '{a['text']}' — 새로 {a['n']}번 → scripts/memory raise {a['cid']}",
                  f"[again] {a['cid']} {where} (level {a['level']}, {a.get('topic') or a['scope']}) '{a['text']}' — {a['n']} new → scripts/memory raise {a['cid']}"))
        for s in a['samples']:
            print(f"    {s['ts'][5:]} {s['who']}: {s['text']}")
    for c in r['new']:
        print(say(f"[새] {c['cid']} 이번 {c['n']} · 옛 말 포함 {c['total']} · {c['days']}일 · 칸 짐작 {c['scope']}",
                  f"[new] {c['cid']} now {c['n']} · with older {c['total']} · {c['days']} days · scope guess {c['scope']}")
              + (say(' [결제·승인 낱말]', ' [payment/approval words]') if c['risky'] else ''))
        for s in c['samples']:
            print(f"    {s['ts'][5:]} {s['who']}: {s['text']}")
        for s in c['before']:
            print(say('    (전에) ', '    (before) ') + f"{s['ts'][5:]} {s['who']}: {s['text']}")


def cli(a):
    data = data_dir()
    cmd = a[0] if a else ''
    try:
        if cmd == 'scan':
            r = scan(data, days=int(_opt(a, '--days', 45)))
            print(json.dumps(r, ensure_ascii=False, indent=1)) if '--json' in a else _print_scan(data, r)
        elif cmd == 'find' and len(a) >= 2:
            f = find_said(data, a[1])
            print(f"{f['cid'] or '-'} · {f['n']} · {f['days']}d · {f['scope']} · {', '.join(f['where'])}")
            for s in f['samples']:
                print(f"    {s['ts'][5:]} {s['who']}: {s['text']}")
        elif cmd == 'add' and len(a) >= 3:
            got = {'lines': [], 'said': []}
            for cid in _opts(a, '--from'):
                g = resolve(data, cid)
                got['lines'] += g['lines']
                got['said'] += g['said']
            try:
                _, line = add(data, a[1], a[2], lines=got['lines'], said=got['said'], hand=_opt(a, '--hand'), why=_opt(a, '--why', ''))
            except Risky as e:
                print(T(data, f"보류 {e.rule['id']} — 결제·승인·권한 말이라 저절로 안 넣었어. 맡은 참모가 사용자에게 묻고, 좋다면 scripts/memory apply {e.rule['id']}",
                        f"on hold {e.rule['id']} — payment/approval/permission words are never added on their own. The owner asks the user; if yes, scripts/memory apply {e.rule['id']}"), file=sys.stderr)
                return 3
            print(line)
        elif cmd == 'apply' and len(a) == 2:
            r = apply(data, a[1])
            print(notice(data, r))
        elif cmd == 'undo' and len(a) == 2:
            r = undo(data, a[1])
            print(T(data, f"되돌림 {r['id']} — '{r['text']}'", f"undone {r['id']} — '{r['text']}'"))
        elif cmd == 'up' and len(a) >= 2:
            got = [resolve(data, c) for c in _opts(a, '--from')]
            _, msg = up(data, a[1], check=_opt(a, '--check'), lines=[u for g in got for u in g['lines']], said=[s for g in got for s in g['said']])
            print(msg)
        elif cmd == 'raise' and len(a) >= 2:
            _, msg = raise_group(data, a[1], check=_opt(a, '--check'))
            print(msg)
        elif cmd == 'level' and len(a) >= 3:
            r = set_level(data, a[1], a[2], check=_opt(a, '--check'))
            print(f"{r['id']} → {r['level']}" + (f" ({r['check']})" if r.get('check') else ''))
        elif cmd == 'skip':
            lines = [u for c in _opts(a, '--from') for u in resolve(data, c)['lines']] + (fresh_lines(data) if '--fresh' in a else [])
            skip(data, lines, _opt(a, '--why', ''))
            print(T(data, f'본 줄 {len(lines)}', f'{len(lines)} lines marked seen'))
        elif cmd == 'list':
            st = load(data)
            if '--json' in a:
                print(json.dumps(st['rules'], ensure_ascii=False, indent=1))
            for r in st['rules']:
                state = 'undone' if r.get('undone') else 'pending' if r.get('pending') else f"L{r['level']}" + (f"/{r['check']}" if r.get('check') else '')
                print(f"{r['id']}  {state:<14} {r['scope']:<22} {r['text']}" + (f"  (hand: {r['hand']})" if r.get('hand') else '')) if '--json' not in a else None
        elif cmd == 'owner' and len(a) == 3 and a[1] == '--set':
            print(T(data, f'공통 기억 알림 → {set_owner(data, a[2])}', f'shared memory notices → {set_owner(data, a[2])}'))
        elif cmd == 'owner' and len(a) == 2:
            print(owner(data, a[1]))
        elif cmd == 'ask' and len(a) == 3:
            if not ask(data, a[1], a[2]):
                print(T(data, f'{a[1]}: 이미 물었어 — 넘겨', f'{a[1]}: already asked — skip'))
                return 1
            print(a[2])
        elif cmd == 'move' and len(a) == 3:
            r = move(data, a[1], a[2])
            print(T(data, f"옮김 {r['id']} — {os.path.basename(r['src'])} → {a[2]} (되돌리기 scripts/memory unmove {r['id']})",
                    f"moved {r['id']} — {os.path.basename(r['src'])} → {a[2]} (undo: scripts/memory unmove {r['id']})"))
        elif cmd == 'unmove' and len(a) == 2:
            r = unmove(data, a[1])
            print(T(data, f"되돌림 — {r['src']}", f"moved back — {r['src']}"))
        elif cmd == 'stats':
            print(stats(data, days=int(_opt(a, '--days', 7))))
        elif cmd == 'schedule':
            print(schedule(data))
        elif cmd == 'guide':
            print(guide(data))
        elif cmd == 'hook' and len(a) == 2 and a[1] in HOOKS:
            return HOOKS[a[1]](data)
        else:
            print(USAGE, file=sys.stderr)
            return 2
    except (KeyError, ValueError, OSError) as e:
        print(f'memory: {e}', file=sys.stderr)
        return 2
    return 0


HOOKS = {}

USAGE = """Auto memory / 알아서 기억 (ADR 0032) — <data>/memory/
  scripts/memory scan [--days 45] [--json]       new user lines since the last run + similar older ones · 새 사람 말과 비슷한 옛 말
  scripts/memory find "<regex>"                   count older user lines (widen same meaning, other words) · 같은 뜻 다른 말 세기
  scripts/memory add <common|orch:<name>|project:<name>> "<rule>" [--from <group>]… [--hand <file>] [--why "…"]
                                                  add a rule (last line = what the owner tells the user); payment/approval words → exit 3, on hold
  scripts/memory apply <id>                       add a rule on hold, after the user said yes · 보류 규칙 넣기
  scripts/memory up <id> [--check english|shots] [--from <group>]   said again → one level up (1 written · 2 every prompt · 3 check)
  scripts/memory raise <again group> [--check english|shots|none]   an [again] group → one level up (rules people wrote enter the ledger) · [또] 올리기
  scripts/memory level <id> <1|2|3> [--check …]   set the level (undo a raise) · 단계 되돌리기
  scripts/memory undo <id>                        remove the rule from where it was written · 규칙 되돌리기
  scripts/memory skip [--from <group>]… [--fresh] [--why "…"]   mark lines seen · 본 줄로
  scripts/memory list [--json]
  scripts/memory owner <scope>                    who to tell (SendMessage address) · 알릴 참모
  scripts/memory owner --set <base name>          who gets shared-memory notices (first, if running) · 공통 알림 받을 참모 정하기
  scripts/memory ask <key> "<what / options / pick>"   ask once per key (exit 1 if asked before) · 한 번만 묻기
  scripts/memory move <memory file> <orch:<name>|project:<name>>   shared memory → that assistant / project CLAUDE.local.md (original → _archive)
  scripts/memory unmove <m-id>                    put it back · 되돌리기
  scripts/memory stats [--days 7]                 one line for the weekly report · 매주 한 줄
  scripts/memory schedule | guide                 the daily routine (sonnet medium) and what it does · 매일 예약과 지침
  scripts/memory hook start|prompt|stop           (hooks only)
"""


# ── 훅: 세션 시작(칸 싣기) · 매 지시(2단계 줄) · 끝내기 전(영어 검사) ──

def read_stdin():
    """훅 입력 — 닫히지 않은 stdin 을 끝없이 기다리지 않게 1초까지만(voice-hint 와 같은 이유)"""
    import threading
    b = []
    t = threading.Thread(target=lambda: b.append(sys.stdin.read()), daemon=True)
    t.start()
    t.join(1)
    try:
        v = json.loads(b[0]) if b and b[0].strip() else {}
    except ValueError:
        v = {}
    return v if isinstance(v, dict) else {}


def _tail(path, size=262144):
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            n = f.tell()
            f.seek(max(0, n - size))
            return f.read().decode('utf-8', 'replace').splitlines()
    except OSError:
        return []


def name_of(data, inp, slow=False):
    """이 세션 이름 — 앱이 적는 live.json → 기록 끝 agent-name 줄 → (slow 면) claude agents"""
    sid = inp.get('session_id') or ''
    snap = read_json(os.path.join(data, 'live.json'), {})
    for s in snap.get('sessions', []) if isinstance(snap.get('sessions'), list) else []:
        if isinstance(s, dict) and sid and s.get('sessionId') == sid and s.get('name'):
            return s['name']
    for l in reversed(_tail(inp.get('transcript_path') or '')):
        if '"agent-name"' in l:
            try:
                n = json.loads(l).get('agentName')
            except ValueError:
                continue
            if n:
                return n
    if slow:
        for a in roster().live_agents(data):
            if isinstance(a, dict) and sid and a.get('sessionId') == sid:
                return a.get('name') or ''
    return ''


def whoami(data, inp, slow=False):
    """(HQ 세션인가, 참모 기본 이름 또는 '')"""
    R, cfg = roster(), cfg_of(data)
    try:
        hq = R.hq_session(inp, cfg, data, os.environ)
    except Exception:
        hq = False
    if not hq:
        return False, ''
    return True, R.orch_base(name_of(data, inp, slow), R.bases_of(cfg)) or ''


def orch_dir(data, base):
    """참모 칸 — 같은 이름으로 새 참모가 태어났으면(orch-roles born 이 칸의 .born 보다 뒤) 옛 칸은 _archive 로 비킨다"""
    d = mem(data, 'orch', base)
    r = read_json(os.path.join(data, 'orch-roles.json'), {}).get(base)
    born = r.get('born') if isinstance(r, dict) and isinstance(r.get('born'), (int, float)) else 0
    mark = os.path.join(d, '.born')
    try:
        had = float(read(mark).strip() or 0)
    except ValueError:
        had = 0
    if os.path.isdir(d) and born and had and born > had:
        dst = mem(data, '_archive', f'orch-{base}-{int(had)}')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.replace(d, dst)
        log(data, {'action': 'orch-reborn', 'orch': base, 'to': dst})
    os.makedirs(d, exist_ok=True)
    if not os.path.exists(mark) or (born and born > had):
        write(mark, str(int(born)))
    return d


def hook_start(data, inp=None):
    inp = read_stdin() if inp is None else inp
    hq, base = whoami(data, inp, slow=True)
    if not hq:
        return 0
    out = []
    if base:
        d = orch_dir(data, base)
        body = read(os.path.join(d, 'MEMORY.md')).strip()
        out.append(T(data, f'[기억] 너({base})만의 기억 칸: {d}/ — 네 맡은 일에만 맞는 선호·결정·사실은 공통 메모리 말고 여기 MEMORY.md 에 한 줄(길면 같은 폴더 파일 + 색인 한 줄). 모든 참모가 알아야 할 것만 공통 메모리에.',
                     f'[memory] Your own memory ({base}): {d}/ — preferences, decisions and facts that only fit your role go in MEMORY.md here (one line; longer → a file in this folder + one index line). Only what every assistant needs goes in the shared memory.'))
        if body:
            out.append(body[:8000])
    common = read(mem(data, 'common.md')).strip()
    if common:
        out.append(common[:4000])
    if out:
        print('\n'.join(out))
    if not os.environ.get('CHAMMO_MEMORY_NO_SCHEDULE') and not os.path.exists(os.path.join(data, 'routines', ROUTINE, 'routine.json')):
        _spawn_schedule()
    return 0


def _spawn_schedule():
    """매일 예약이 없으면 뒤에서 한 번 건다 — 훅은 기다리지 않는다"""
    import subprocess
    try:
        kw = {'start_new_session': True} if os.name != 'nt' else {'creationflags': 0x08000000}
        subprocess.Popen([sys.executable or 'python3', os.path.join(HERE, 'memory'), 'schedule'], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)
    except OSError:
        pass


def hook_prompt(data, inp=None):
    inp = read_stdin() if inp is None else inp
    if not any(r.get('level', 1) >= 2 for r in active(load(data))):
        return 0  # 빠른 길 — 2단계 규칙이 없으면 이름도 안 찾는다
    hq, base = whoami(data, inp)
    if not hq:
        return 0
    lines = pinned(data, f'orch:{base}' if base else None)
    if lines:
        print(T(data, '늘 지킬 것(사용자가 되풀이한 말): ', 'Always (the user kept repeating these): ') + ' / '.join(lines))
    return 0


CODE = re.compile(r'```.*?```|`[^`\n]*`|https?://\S+|(?:~|\.{0,2})?/[\w.\-/가-힣]+|[\w.+-]+@[\w-]+\.\w+', re.S)
ENG_WORD = re.compile(r"[A-Za-z][A-Za-z']+")
FUNC = {'the', 'and', 'to', 'of', 'is', 'are', 'was', 'were', 'it', 'this', 'that', 'you', 'i', "i'm", 'we', 'will', 'on', 'for', 'with', 'in', 'a', 'an', 'be', 'have', 'has', 'not', 'or', 'but', 'so', 'if', 'what', 'whether'}
ERRORISH = re.compile(r'error|exception|traceback|failed|warning|errno|enoent|denied|not found|usage:', re.I)
HANGUL_RE = re.compile(r'[가-힣]')


def english_leak(text):
    """한글 사용자에게 간 답 속 영어 문장 — 코드·경로·주소·인용·표·오류 글은 뺀다. 찾으면 그 줄, 없으면 ''"""
    t = CODE.sub(' ', text or '')
    for line in t.splitlines():
        s = line.strip()
        if not s or HANGUL_RE.search(s) or s.startswith(('>', '|')) or '|' in s or ERRORISH.search(s):
            continue
        ws = ENG_WORD.findall(s)
        if len(ws) >= 8 and sum(1 for w in ws if w.lower() in FUNC) >= 2:
            return s[:120]
    return ''


def last_reply(inp):
    if isinstance(inp.get('last_assistant_message'), str):
        return inp['last_assistant_message']
    for l in reversed(_tail(inp.get('transcript_path') or '')):
        if '"assistant"' not in l:
            continue
        try:
            row = json.loads(l)
        except ValueError:
            continue
        c = (row.get('message') or {}).get('content') if row.get('type') == 'assistant' else None
        if isinstance(c, list):
            text = '\n'.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
            if text.strip():
                return text
    return ''


def hook_stop(data, inp=None):
    inp = read_stdin() if inp is None else inp
    if inp.get('stop_hook_active') or en(data):
        return 0  # 한 번만 — 다시 쓴 답은 그대로 보낸다
    st = load(data)
    if not any(r.get('check') == 'english' and r.get('level') == 3 for r in active(st)):
        return 0
    hq, base = whoami(data, inp)
    if not hq or not check_on(data, 'english', f'orch:{base}' if base else None):
        return 0
    bad = english_leak(last_reply(inp))
    if bad:
        print(json.dumps({'decision': 'block', 'reason': f'답에 영어 문장이 섞였어("{bad}") — 사용자는 한국어로 읽는다. 같은 내용을 한글로 다시 써(코드·명령·경로 이름은 그대로).'}, ensure_ascii=False))
        log(data, {'action': 'check', 'check': 'english', 'orch': base, 'line': bad})
    return 0


HOOKS.update({'start': lambda d: hook_start(d), 'prompt': lambda d: hook_prompt(d), 'stop': lambda d: hook_stop(d)})


# ── task send·done 연결: 늘 지킬 줄 · 사람이 보낸 화면 전후 캡처(shots) ──

SHOT = re.compile(r'#img\d+\s+"([^"]+)"|\[Image #\d+\]|(/[^\s"\']+\.(?:png|jpe?g|gif|webp|heic))', re.I)
FIXED = re.compile(r'고쳤|고침|고쳐|수정(?:했|함|완료|됨)|해결|바로잡|\bfixed\b|\bfix(?:es)?\b|\bresolved\b|사라졌|이제\s*(?:돼|된다|됨|잘)', re.I)
IMG = re.compile(r'[^\s"\'()]+\.(?:png|jpe?g|gif|webp|heic|mp4|mov|webm)\b', re.I)
SHOT_MIN = 60


def transcript_of(data, sid, root=None):
    root = root or os.path.expanduser('~/.claude/projects')
    hq = roster().fwd(roster().hq_path(cfg_of(data), data, os.environ)).rstrip('/')  # 설정은 ~/… 로 적혀 있다
    p = os.path.join(root, launch_key(hq), f'{sid}.jsonl')
    if os.path.exists(p):
        return p
    import glob
    hit = glob.glob(os.path.join(glob.escape(root), '*', glob.escape(sid) + '.jsonl'))
    return hit[0] if hit else ''


def recent_shots(data, sid, root=None, minutes=SHOT_MIN):
    """참모(sid)가 최근 minutes 분 사람에게서 받은 그림 — #img 경로·그림 경로·붙인 그림 표시. [앱] 줄·세션 간 말은 뺀다"""
    if not sid:
        return []
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minutes)
    out = []
    for l in _tail(transcript_of(data, sid, root), 1048576):
        if '"human"' not in l:
            continue
        try:
            row = json.loads(l)
        except ValueError:
            continue
        at, text = _parse_ts(row.get('timestamp')), _content(row) if isinstance(row, dict) else None
        if not at or at < since or not text or SKIP.search(text):
            continue
        for m in SHOT.finditer(text.split('(넘긴 남의 말')[0]):
            out.append(m.group(1) or m.group(2) or m.group(0))
    return list(dict.fromkeys(out))[:5]


def on_send(data, ev, project, sid=None, root=None):
    """send 가 부른다 — ev 에 사람이 보낸 화면(shots)을 적고, 세션 지시에 붙일 줄을 돌려준다(늘 지킬 규칙·켜진 검사)"""
    sid = os.environ.get('CLAUDE_CODE_SESSION_ID', '') if sid is None else sid
    try:
        shots = recent_shots(data, sid, root)
    except Exception:
        shots = []
    if shots:
        ev['shots'] = shots
    me = f"orch:{ev['fromName']}" if ev.get('fromName') else None
    head = T(data, '늘 지킬 것 — 지시에 붙여: ', 'Always — append to the instruction: ')
    st = active(load(data))
    rules = [r['text'] for r in st if r['scope'] == 'common'] + [r['text'] for r in st if r['scope'] == f'project:{project}' and r.get('level', 1) >= 2]
    out, size = [], 0
    for t in rules:
        if size + len(t) > PIN_CHARS:
            break
        out.append(head + t)
        size += len(t)
    if check_on(data, 'english', me) and not en(data):
        out.append(head + '회신·답은 한글로 — 영어 문장을 섞지 마(코드·명령·경로 이름은 그대로)')
    if shots and check_on(data, 'shots', me):
        out.append(head + T(data, f"사람이 보낸 화면({', '.join(shots)})을 고치는 일이면 — 고친 뒤 같은 화면을 다시 캡처해 회신에 전후 경로를 붙여(없으면 끝난 걸로 안 친다)",
                            f"If this fixes the screen the user sent ({', '.join(shots)}) — capture the same screen after the fix and put the before/after paths in your reply (no capture, not done)"))
    return out


def on_done(data, tid, note, events, append_fn, no_shot=None):
    """done 이 부른다 — (종료 코드 또는 None, done 기록에 더할 칸). 사람이 보낸 화면이 있는 일인데 '고쳤다' 꼴이고 새 캡처가 없으면 한 번 되묻는다(5)"""
    send = next((e for e in events if isinstance(e, dict) and e.get('type') == 'send' and e.get('task') == tid), None)
    shots = (send or {}).get('shots') or []
    if not shots or no_shot or not FIXED.search(note or ''):
        return None, ({'noShot': no_shot} if no_shot and shots else {})
    if not check_on(data, 'shots', f"orch:{send['fromName']}" if send.get('fromName') else None):
        return None, {}
    mine = {s for s in shots}
    if any(p not in mine and not any(p.endswith(s) or s.endswith(p) for s in mine) for p in IMG.findall(note)):
        return None, {}
    if any(isinstance(e, dict) and e.get('task') == tid and e.get('shot_ask') for e in events):
        print(T(data, '캡처 없이 남김 — 되묻기는 한 번만. 주간 정리에서 센다', 'recorded without a capture — asked once only; the weekly tidy counts these'), file=sys.stderr)
        return None, {'noShot': True}
    append_fn({'ts': now(), 'type': 'note', 'task': tid, 'note': 'shots — 새 캡처 없는 고침 done, 한 번 되물음', 'shot_ask': 1})
    print(T(data, f"done 안 남겼어 — 사람이 보낸 화면({', '.join(shots)})을 고친 일인데 고친 뒤 캡처가 없어. 같은 화면을 다시 찍어(세션에 시키거나 직접) 그 경로를 결과에 넣고 다시 부르거나, 캡처할 수 없는 일이면 --no-shot '<이유>'",
            f"done not recorded — this fixes the screen the user sent ({', '.join(shots)}) but there is no after-capture. Capture the same screen again and put its path in the result, or if it can't be captured, --no-shot '<reason>'"), file=sys.stderr)
    return 5, {}


# ── 공통 메모리 → 참모 칸·프로젝트로 옮기기(되돌림 unmove) ──

FRONT = re.compile(r'^---\n.*?\n---\n', re.S)


def local_ignored(root):
    """그 폴더의 CLAUDE.local.md 가 커밋될 길이 없나 — 깃이 아니거나 git 이 무시할 때만(계정·사람 이름이 섞일 수 있다)"""
    import subprocess
    try:
        r = subprocess.run(['git', '-C', root, 'rev-parse', '--is-inside-work-tree'], capture_output=True, text=True)
        if r.returncode != 0:
            return True
        return subprocess.run(['git', '-C', root, 'check-ignore', '-q', 'CLAUDE.local.md'], capture_output=True).returncode == 0
    except OSError:
        return False


def _index_line(index_text, fname):
    return next((l for l in index_text.splitlines() if f']({fname})' in l), None)


def move(data, src, scope):
    """메모리 파일 하나를 참모 칸(orch:<이름>)이나 프로젝트 CLAUDE.local.md(project:<이름>)로. 원본은 같은 폴더 _archive/, 색인 줄은 빼되
    MEMORY.md.bak-<날> 을 그날 처음 한 번 남긴다. 기록 id 로 unmove"""
    kind, name = parse_scope(scope)
    if kind == 'common':
        raise ValueError('move goes to orch:<name> or project:<name>')
    src = os.path.abspath(src)
    mdir, fname = os.path.dirname(src), os.path.basename(src)
    index = os.path.join(mdir, 'MEMORY.md')
    text, idx = read(src), read(index)
    if not text:
        raise ValueError(f'no memory file {src}')
    line = _index_line(idx, fname) or f'- [{fname[:-3]}]({fname})'
    rid = f'm-{secrets.token_hex(2)}'
    if kind == 'project':
        root = os.path.join(os.path.expanduser(cfg_of(data).get('devRoot') or ''), name)  # 설정은 ~/… 처럼 ~ 를 쓴다
        if not os.path.isdir(root) or not local_ignored(root):
            raise ValueError(f'{root}/CLAUDE.local.md is not git-ignored (or the folder is missing) — move it to an assistant (orch:<name>) instead')
        dest = os.path.join(root, 'CLAUDE.local.md')
        title = re.match(r'- \[(.+?)\]', line)
        block = f"<!-- {rid} {fname} -->\n### {title.group(1) if title else fname[:-3]}\n{FRONT.sub('', text).strip()}\n<!-- /{rid} -->"
        write(dest, _with_line(read(dest), T(data, '## 기억 (HQ 메모리에서 옮김)', '## Memory (moved from the HQ memory)'), block))
    else:
        d = orch_dir(data, name)
        dest = os.path.join(d, fname)
        if os.path.exists(dest):
            raise ValueError(f'{dest} already exists')
        write(dest, text)
        mi = os.path.join(d, 'MEMORY.md')
        write(mi, _with_line(read(mi), T(data, '## 옮겨 온 기억 (공통 메모리에서)', '## Moved from the shared memory'), line))
    bak = f"{index}.bak-{datetime.date.today().strftime('%Y%m%d')}"
    if idx and not os.path.exists(bak):
        write(bak, idx)
    arch = os.path.join(mdir, '_archive', fname)
    os.makedirs(os.path.dirname(arch), exist_ok=True)
    if os.path.exists(arch):
        arch = f"{arch[:-3]}-{rid}.md"
    os.replace(src, arch)
    if _index_line(idx, fname):
        write(index, '\n'.join(l for l in idx.split('\n') if l != line))
    return log(data, {'action': 'move', 'id': rid, 'src': src, 'archived': arch, 'index_line': line, 'scope': scope, 'dest': dest})


def unmove(data, rid):
    rec = next((r for r in reversed([json.loads(l) for l in read(mem(data, 'log.jsonl')).splitlines() if l.strip()]) if r.get('id') == rid), None)
    if not rec or rec.get('action') != 'move':
        raise KeyError(f'no move {rid} (or already undone)')
    if os.path.exists(rec['src']):
        raise ValueError(f"{rec['src']} is back already")
    kind, _ = parse_scope(rec['scope'])
    if kind == 'project':
        body = read(rec['dest'])
        body = re.sub(rf"\n?<!-- {re.escape(rid)} [^\n]*-->\n.*?<!-- /{re.escape(rid)} -->", '', body, flags=re.S)
        head = T(data, '## 기억 (HQ 메모리에서 옮김)', '## Memory (moved from the HQ memory)')
        body = re.sub(rf'\n*{re.escape(head)}\n*$', '\n', body)  # 비었으면 머리도
        write(rec['dest'], body if body.strip() else '')
    else:
        try:
            os.remove(rec['dest'])
        except OSError:
            pass
        mi = os.path.join(os.path.dirname(rec['dest']), 'MEMORY.md')
        write(mi, '\n'.join(l for l in read(mi).split('\n') if l != rec['index_line']))
    os.replace(rec['archived'], rec['src'])
    index = os.path.join(os.path.dirname(rec['src']), 'MEMORY.md')
    idx = read(index)
    if rec['index_line'] not in idx.split('\n'):
        write(index, idx.rstrip('\n') + '\n' + rec['index_line'] + '\n')
    log(data, {'action': 'unmove', 'id': rid + '-undone', 'of': rid})
    return rec

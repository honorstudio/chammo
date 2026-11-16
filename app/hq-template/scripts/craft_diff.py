"""참모 앱 문서 전후 비교 — 사람이 고친 것을 쪽·글·도형 단위 한 줄로(scripts/craft 의 돌려받음·open·changes).
13개 앱 공통: 앱에 묻지 않고 저장된 파일 두 벌을 본다(document.inspect 는 포토·표뿐이라 슬라이드 돌려받음이 '못 읽음'이던 것, 2026-11-16).
표준 라이브러리만 — pptx·docx·xlsx(zip 안 XML), 앱 자기 형식 JSON(.vectorcraft·.fcproj …), PDF 쪽 수, 나머지는 크기"""
import difflib, json, re, zipfile
from xml.etree import ElementTree as ET

CAP = 8  # 한 줄에 적는 바뀐 곳 — 넘으면 '… 외 N곳 더'
TXT = 24  # 글 한 토막 길이
NOISE = re.compile(r'(^id$|_id$|uuid|guid|time|date|modified|created|version|hash|seed|rev$)', re.I)  # 사람이 고친 게 아닌 값


def _q(s):
    s = ' '.join(str(s).split())
    return f"'{s[:TXT]}…'" if len(s) > TXT else f"'{s}'"


def _tag(e):
    return e.tag.rsplit('}', 1)[-1]


def _paras(xml, p, t):
    """문단(p)마다 글(t)을 이은 목록 — 빈 문단은 뺀다"""
    out = []
    for e in ET.fromstring(xml).iter():
        if _tag(e) == p:
            s = ''.join(x.text or '' for x in e.iter() if _tag(x) == t)
            if s.strip() and s.strip() != '‹#›':  # 쪽 번호 자리표 — 사람이 쓴 글이 아니다
                out.append(s)
    return out


def _rels(z, path):
    """관계 파일 → {rId: 대상 경로(zip 안)}"""
    base = path.rsplit('/_rels/', 1)[0]
    try:
        root = ET.fromstring(z.read(path))
    except KeyError:
        return {}
    return {e.get('Id'): (base + '/' + e.get('Target', '').lstrip('/')).replace('//', '/') for e in root if e.get('Id')}


def _ordered(z, main, rels, item):
    """presentation.xml·workbook.xml 의 순서대로 [(이름, zip 경로)]"""
    rid = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
    r = _rels(z, rels)
    return [(e.get('name'), r[e.get(rid)]) for e in ET.fromstring(z.read(main)).iter() if _tag(e) == item and e.get(rid) in r]


def _pptx(z):
    units = []
    for _, path in _ordered(z, 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'sldId'):
        xml = z.read(path)
        tree = [e for e in ET.fromstring(xml).iter() if _tag(e) == 'spTree']
        kids = [_tag(k) for t in tree[:1] for k in t if _tag(k) in ('sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp')]
        units.append({'text': _paras(xml, 'p', 't'), 'shapes': len(kids), 'pics': kids.count('pic'), 'raw': xml})
    return {'kind': 'pptx', 'units': units}


def _xlsx(z):
    try:
        shared = [''.join(t.text or '' for t in si.iter() if _tag(t) == 't') for si in ET.fromstring(z.read('xl/sharedStrings.xml')) if _tag(si) == 'si']
    except KeyError:
        shared = []
    sheets = {}
    for name, path in _ordered(z, 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'sheet'):
        cells = {}
        for c in ET.fromstring(z.read(path)).iter():
            if _tag(c) != 'c':
                continue
            f = next((x.text for x in c if _tag(x) == 'f'), None)
            v = next((x.text for x in c if _tag(x) == 'v'), None)
            if c.get('t') == 's' and v is not None and v.isdigit() and int(v) < len(shared):
                v = shared[int(v)]
            elif c.get('t') == 'inlineStr':
                v = ''.join(t.text or '' for t in c.iter() if _tag(t) == 't')
            cells[c.get('r')] = '=' + f if f else (v or '')
        sheets[name] = cells
    return {'kind': 'xlsx', 'sheets': sheets}


def _flat(v, path=(), out=None):
    """JSON → (경로, 값) 잎과 목록 길이. 경로의 번호는 [] 로 묶어 보여 준다"""
    out = out if out is not None else {'leaf': {}, 'len': {}}
    if isinstance(v, dict):
        for k, x in v.items():
            if not NOISE.search(str(k)):
                _flat(x, path + (str(k),), out)
    elif isinstance(v, list):
        out['len'][path] = len(v)
        for i, x in enumerate(v):
            _flat(x, path + (i,), out)
    else:
        out['leaf'][path] = v
    return out


def model(path):
    """파일 → 비교할 모양. 못 읽으면 None"""
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError:
        return None
    m = {'kind': 'bin', 'size': len(data), 'data': data}
    try:
        if data[:2] == b'PK':
            with zipfile.ZipFile(path) as z:
                names = set(z.namelist())
                if 'ppt/presentation.xml' in names:
                    return {**m, **_pptx(z)}
                if 'word/document.xml' in names:
                    xml = z.read('word/document.xml')
                    root = list(ET.fromstring(xml).iter())
                    return {**m, 'kind': 'docx', 'paras': _paras(xml, 'p', 't'),
                            'pics': sum(_tag(e) == 'drawing' for e in root), 'tables': sum(_tag(e) == 'tbl' for e in root)}
                if 'xl/workbook.xml' in names:
                    return {**m, **_xlsx(z)}
        elif data.lstrip()[:1] in (b'{', b'['):
            return {**m, 'kind': 'json', 'json': _flat(json.loads(data))}
        elif data[:4] == b'%PDF':
            return {**m, 'kind': 'pdf', 'pages': len(re.findall(rb'/Type\s*/Page(?!s)', data))}
    except (zipfile.BadZipFile, ET.ParseError, ValueError, KeyError):
        pass
    return m


def _texts(a, b, label=''):
    """글 목록 전후 → ['라벨 '옛'→'새'', '글 추가 …', '글 지움 …']"""
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == 'equal':
            continue
        old, new = a[i1:i2], b[j1:j2]
        for x, y in zip(old, new):
            out.append(f'{label}{_q(x)}→{_q(y)}')
        out += [f'{label}글 추가 {_q(y)}' for y in new[len(old):]]
        out += [f'{label}글 지움 {_q(x)}' for x in old[len(new):]]
    return out


def _slide(n, a, b):
    out = _texts(a['text'], b['text'], f'{n}쪽 ')
    if a['pics'] != b['pics']:
        out.append(f"{n}쪽 그림 {a['pics']}→{b['pics']}")
    elif a['shapes'] != b['shapes']:
        out.append(f"{n}쪽 도형 {a['shapes']}→{b['shapes']}")
    if not out and a['raw'] != b['raw']:
        out.append(f'{n}쪽 모양 바뀜(위치·크기·색)')
    return out


def _pptx_diff(a, b):
    ua, ub = a['units'], b['units']
    out = [f'쪽 {len(ua)}→{len(ub)}'] if len(ua) != len(ub) else []
    sig = lambda u: tuple(u['text']) or (u['raw'],)  # 글이 같은 쪽끼리 짝 — 쪽을 끼우거나 빼도 뒤 쪽을 '고침'으로 안 센다
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, [sig(u) for u in ua], [sig(u) for u in ub], autojunk=False).get_opcodes():
        if op == 'equal':
            for i, j in zip(range(i1, i2), range(j1, j2)):
                out += _slide(j + 1, ua[i], ub[j])
            continue
        pairs = list(zip(range(i1, i2), range(j1, j2)))
        for i, j in pairs:
            out += _slide(j + 1, ua[i], ub[j])
        for j in range(j1 + len(pairs), j2):
            out.append(f"{j + 1}쪽 추가" + (f"({_q(ub[j]['text'][0])})" if ub[j]['text'] else ''))
        for i in range(i1 + len(pairs), i2):
            out.append(f"{i + 1}쪽 지움" + (f"({_q(ua[i]['text'][0])})" if ua[i]['text'] else ''))
    return out


def _docx_diff(a, b):
    out = [f"문단 {len(a['paras'])}→{len(b['paras'])}"] if len(a['paras']) != len(b['paras']) else []
    out += _texts(a['paras'], b['paras'])
    out += [f'{k} {a[key]}→{b[key]}' for k, key in (('그림', 'pics'), ('표', 'tables')) if a[key] != b[key]]
    return out


def _xlsx_diff(a, b):
    out = [f"시트 '{n}' 추가" for n in b['sheets'] if n not in a['sheets']] + [f"시트 '{n}' 지움" for n in a['sheets'] if n not in b['sheets']]
    for n, cb in b['sheets'].items():
        ca = a['sheets'].get(n)
        if ca is None:
            continue
        for k in sorted(set(ca) | set(cb), key=lambda r: (len(r), r)):
            if ca.get(k, '') != cb.get(k, ''):
                out.append(f"'{n}'!{k} {_q(ca.get(k, ''))}→{_q(cb.get(k, ''))}")
    return out


def _name(path):
    keys = [p for p in path if isinstance(p, str)]
    return '.'.join(keys[-2:]) or '목록'


def _json_diff(a, b):
    ja, jb = a['json'], b['json']
    out = []
    for p in sorted(set(ja['len']) | set(jb['len']), key=len):
        x, y = ja['len'].get(p, 0), jb['len'].get(p, 0)
        if x != y:
            out.append(f'{_name(p)} {x}→{y}개')
    nums = 0
    for p in ja['leaf'].keys() & jb['leaf'].keys():
        x, y = ja['leaf'][p], jb['leaf'][p]
        if x == y:
            continue
        if isinstance(x, str) or isinstance(y, str):
            out.append(f'{_q(x)}→{_q(y)}')
        else:
            nums += 1
    if nums:
        out.append(f'숫자 {nums}곳(위치·크기·색 등)')
    return out


def lines(a, b):
    """두 모양 → 바뀐 곳 목록(빈 목록 = 같음)"""
    if a['data'] == b['data']:
        return []
    kind = a['kind'] if a['kind'] == b['kind'] else 'bin'
    out = {'pptx': _pptx_diff, 'docx': _docx_diff, 'xlsx': _xlsx_diff, 'json': _json_diff}.get(kind, lambda *_: [])(a, b)
    if kind == 'pdf' and a['pages'] != b['pages']:
        out.append(f"쪽 {a['pages']}→{b['pages']}")
    return out or [f"파일 바뀜(크기 {_kb(a['size'])}→{_kb(b['size'])})"]


def _kb(n):
    return f'{n}B' if n < 1024 else f'{n / 1024:.0f}KB' if n < 1024 * 1024 else f'{n / 1048576:.1f}MB'


def diff(before, after):
    """파일 두 벌 → 한 줄('바뀐 것 없음' 포함). 하나라도 못 읽으면 None"""
    a, b = model(before), model(after)
    if a is None or b is None:
        return None
    out = lines(a, b)
    if not out:
        return '바뀐 것 없음'
    more = len(out) - CAP
    return ' · '.join(out[:CAP]) + (f' · … 외 {more}곳 더' if more > 0 else '')

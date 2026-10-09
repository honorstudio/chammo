"""교훈 → 프로젝트 스킬 승격 — scripts/task 의 lesson-review · lesson-group · lesson-drop · lesson-promote · lesson-restore (+ 카드로 먼저 묻는 lesson-propose).
Lessons → project skills, used by scripts/task.

교훈은 지시마다 통째로 붙는다(비용을 매번 냄). 같은 주제가 쌓이면 '부를 때만 열리는' 프로젝트 스킬로 옮긴다.
묶는 판단은 참모(모델)가 하고, 이 파일은 번호·이름 검증과 옮기기만 한다.
- 묶기(lesson-group)는 사람 답 없이 바로 — 되돌리기 쉬워서다(원본은 _archive, lesson-restore). 사람에겐 결과 한 줄만(2026-10-08)
- 같은 이름으로 다시 group 하면 그 스킬에 덧붙는다(새 스킬 남발 방지)
- 버리기(lesson-drop)만 결정 대기함 카드로 사람에게 묻고, 답이 오면 lesson-promote
- 스킬 자리: <프로젝트>/.claude/skills/lesson-<주제>/SKILL.md — 커밋되지 않는 자리만(교훈에 계정 이름이 섞일 수 있다)
- 원본 줄은 지우지 않고 <데이터>/lessons/_archive/<프로젝트>.md 로, 만든 기록은 <데이터>/lessons/skills.jsonl
- 계획: docs/plans/2026-10-06-self-learning.md (1단계)
"""
import datetime, json, os, re, shutil, subprocess

PREFIX = 'lesson-'
NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,40}$')
GLOBAL = ('_common', '_app')     # 여러 프로젝트에 붙는 칸 — 전역 스킬은 2단계(사람 확인 없이 안 쓴다)
# 사람 답이 '하지 마'면 승격하지 않는다. 앱 '처리함' 은 치우기지 승인이 아니다
NO = re.compile(r'그대로|아니|말자|말아|하지 ?마|안 ?(해|돼|묶)|처리함|다시|\bhandled\b|\bkeep\b|\bno\b|\bdon\'?t\b|\bredo\b', re.I)
DROP = re.compile(r'버려|버리|빼|지워|\bdrop\b|\bdiscard\b', re.I)
PREVIEW = 8          # 카드에 보여 줄 줄 수
MIN_NEW = 3          # 새 스킬 하나에 최소 줄 수 — 한두 줄짜리 스킬은 남발이다(덧붙일 땐 1줄도 된다)
SEND_HEAD = ('이 프로젝트 교훈 — 지시에 붙여: ', 'project lesson — append to your message: ')


class Env:
    """scripts/task 가 넘기는 것 — 경로와 기록 함수(주인 HQ 판·공개판 둘 다 같은 모양)"""
    def __init__(self, lessons, dev, log, T, add_lesson, append, now, me=None, lesson_max=12):
        self.lessons, self.dev, self.log, self.T = lessons, dev, log, T
        self.add_lesson, self.append, self.now, self.me, self.lesson_max = add_lesson, append, now, me, lesson_max


class Refuse(Exception):
    pass


# ── 순수 함수 ──

def parse_picks(spec, n):
    """'3,1,4-5' → [1,3,4,5]. 1..n 밖이거나 모양이 이상하면 ValueError"""
    out = set()
    parts = [p.strip() for p in (spec or '').split(',')]
    if not parts or any(not p for p in parts):
        raise ValueError(spec)
    for p in parts:
        m = re.fullmatch(r'(\d+)(?:-(\d+))?', p)
        if not m:
            raise ValueError(p)
        a, b = int(m.group(1)), int(m.group(2) or m.group(1))
        if a < 1 or b > n or a > b:
            raise ValueError(p)
        out.update(range(a, b + 1))
    return sorted(out)


def skill_name(raw):
    """'tauri-dev' → 'lesson-tauri-dev'. 영문 소문자·숫자·- 만"""
    s = (raw or '').strip()
    s = s[len(PREFIX):] if s.startswith(PREFIX) else s
    if not NAME.fullmatch(s):
        raise ValueError(raw)
    return PREFIX + s


def without_lesson(body, lesson):
    """'## 교훈'(또는 '## Lessons') 칸 안의 '- <교훈>' 줄 하나를 뺀 글, 없으면 None — app/src-tauri/src/lessons.rs without_line 과 같은 규칙.
    칸 밖(계정·미룬 할 일)은 같은 줄이 있어도 안 건드린다"""
    lines = body.split('\n')
    start = next((i for i, l in enumerate(lines) if l.startswith('## 교훈') or l.startswith('## Lessons')), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
    i = next((k for k in range(start + 1, end) if lines[k].rstrip() == f'- {lesson}'), None)
    if i is None:
        return None
    return '\n'.join(lines[:i] + lines[i + 1:])


def remove_lines(text, lessons):
    """교훈 파일에서 그 줄들(처음 나온 것 하나씩)만 뺀다 → (새 글, 실제로 뺀 줄)"""
    lines = text.split('\n')
    removed = []
    for lesson in lessons:
        i = next((k for k, l in enumerate(lines) if l.startswith('- ') and l[2:].strip() == lesson), None)
        if i is not None:
            del lines[i]
            removed.append(lesson)
    return '\n'.join(lines), removed


def send_chars(T, lessons):
    """그 줄들이 지시에 붙을 때 글자 수(머리 포함)"""
    head = T(*SEND_HEAD)
    return sum(len(head) + len(l) + 1 for l in lessons)


def skill_entry(name, desc):
    return f'{name}: {desc}'


def skills_line(T, skills_dir, entries):
    """승격한 스킬들 대신 지시에 붙는 한 줄 — 경로는 한 번만. 워크트리 세션처럼 스킬 목록에 안 보이는 곳에서도 경로로 읽게"""
    return T(f'교훈 스킬 — 그 일이면 먼저 열어(목록에 없으면 {skills_dir}/<이름>/SKILL.md 를 읽어): ',
             f'lesson skills — open the one for this work first (if it is not listed, read {skills_dir}/<name>/SKILL.md): ') + ' / '.join(entries)


# ── 파일 ──

def _read(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except OSError:
        return ''


def _write(path, text):
    """임시 파일에 쓰고 옮긴다 — task send 가 반쯤 쓴 파일을 읽지 않게"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, path)


def _lines(env, project):
    return [l.strip()[2:] for l in _read(os.path.join(env.lessons, f'{project}.md')).splitlines() if l.startswith('- ')]


def _records(env):
    out = []
    for l in _read(os.path.join(env.lessons, 'skills.jsonl')).splitlines():
        try:
            out.append(json.loads(l))
        except ValueError:
            pass
    return out


def active_skills(env, project):
    """그 프로젝트에 지금 살아 있는(되돌리지 않은) 우리 스킬 {이름: 기록}"""
    out = {}
    for r in _records(env):
        if r.get('project') != project:
            continue
        if r.get('action') == 'promote':
            cur = out.setdefault(r['skill'], {'lines': []})
            cur['lines'] += [l for l in r.get('lines', []) if l not in cur['lines']]
            cur.update(desc=r.get('desc', ''), path=r.get('path', ''))
        elif r.get('action') == 'restore':
            out.pop(r.get('skill'), None)
    return out


def skill_lines(env, project):
    """task send 가 교훈 줄 대신 붙일 줄 — 살아 있는 스킬이 있으면 한 줄, 없으면 []"""
    live = [(n, s) for n, s in active_skills(env, project).items() if os.path.exists(s['path'])]
    if not live:
        return []
    return [skills_line(env.T, os.path.dirname(os.path.dirname(live[0][1]['path'])), [skill_entry(n, s['desc']) for n, s in live])]


def _skill_dir(env, project, name):
    return os.path.join(env.dev, project, '.claude', 'skills', name)


def _git(root, *args):
    return subprocess.run(['git', '-C', root, *args], capture_output=True, text=True)


def ensure_ignored(env, root, rel):
    """rel 이 커밋되지 않게. git 저장소가 아니면 그대로 괜찮다.
    안 막혀 있으면 .git/info/exclude 에 한 줄(그 맥에만 — 커밋되는 .gitignore 는 안 건드린다)"""
    T = env.T
    if _git(root, 'rev-parse', '--git-dir').returncode != 0:
        return
    if _git(root, 'ls-files', '--error-unmatch', rel).returncode == 0:
        raise Refuse(T(f'{rel} 는 git 이 추적하는 파일이라 교훈을 넣을 수 없어 — 커밋되면 계정 이름이 샐 수 있다',
                       f'{rel} is tracked by git, so lessons cannot go there — they could leak account names into commits'))
    if _git(root, 'check-ignore', '-q', rel).returncode == 0:
        return
    p = _git(root, 'rev-parse', '--git-path', 'info/exclude').stdout.strip()
    excl = p if os.path.isabs(p) else os.path.join(root, p)
    body = _read(excl)
    line = f'/.claude/skills/{PREFIX}*/'
    if line not in body.splitlines():
        os.makedirs(os.path.dirname(excl), exist_ok=True)
        with open(excl, 'a', encoding='utf-8') as f:
            f.write(('' if not body or body.endswith('\n') else '\n') + f'# Chammo 교훈 스킬 — 커밋하지 않는다\n{line}\n')
    if _git(root, 'check-ignore', '-q', rel).returncode != 0:
        # .gitignore 가 스킬 폴더를 '!' 로 다시 추적하면(직원 공유 스킬 — project-a) info/exclude 보다 그쪽이 이긴다 — 어느 줄인지·넣을 줄을 알려 준다
        hits = _unignore_lines(root)
        where = ', '.join(hits) if hits else '.gitignore'
        raise Refuse(T(f'{rel} 를 git 에서 빼지 못했어 — {where} 가 스킬 폴더를 다시 추적하게 해. 그 .gitignore 맨 끝에 `{line}` 한 줄을 넣고(커밋돼도 괜찮은 줄) 다시 해',
                       f'Could not keep {rel} out of git — {where} re-includes the skills folder. Add `{line}` at the end of that .gitignore (safe to commit) and retry'))


def _unignore_lines(root):
    """저장소 맨 위 .gitignore 에서 .claude 를 다시 추적하게 하는 '!' 줄 — '.gitignore:94 !.claude/skills/*/' 모양"""
    out = []
    for i, ln in enumerate(_read(os.path.join(root, '.gitignore')).splitlines(), 1):
        t = ln.strip()
        if t.startswith('!') and '.claude' in t:
            out.append(f'.gitignore:{i} {t}')
    return out[-1:]


def skill_body(T, name, desc, project, lessons, src):
    head = f'---\nname: {name}\ndescription: {json.dumps(desc, ensure_ascii=False)}\n---\n\n'
    intro = T(f'# {project} 교훈 — {name[len(PREFIX):]}\n\n지시마다 붙던 교훈 줄을 `scripts/task lesson-promote` 로 옮겨 온 것({src}). 확인된 함정 — 같은 벽에 두 번 안 박게.\n'
              f'틀린 줄을 발견하면 회신 끝에 "교훈: [스킬 {name} 정정] <고친 한 줄>" 로 알려 줘(본문은 사람이 확인하고 고친다).\n\n## 교훈\n',
              f'# {project} lessons — {name[len(PREFIX):]}\n\nLesson lines that used to ride on every instruction, moved here by `scripts/task lesson-promote` ({src}). Confirmed pitfalls.\n'
              f'If a line turns out wrong, end your reply with "Lesson: [skill {name} fix] <corrected line>" (a person reviews and edits this file).\n\n## Lessons\n')
    return head + intro + ''.join(f'- {l}\n' for l in lessons)


def _skill_lessons(text):
    """SKILL.md 의 '## 교훈' 칸 줄들"""
    out, inside = [], False
    for l in text.splitlines():
        if l.startswith('## '):
            inside = l.startswith('## 교훈') or l.startswith('## Lessons')
        elif inside and l.startswith('- '):
            out.append(l[2:].strip())
    return out


def _events(env):
    out = []
    for l in _read(env.log).splitlines():
        try:
            out.append(json.loads(l))
        except ValueError:
            pass
    return out


def _unmirror(env, project, lessons):
    path = os.path.join(env.dev, project, 'CLAUDE.local.md')
    body = _read(path)
    if not body:
        return
    changed = False
    for l in lessons:
        nxt = without_lesson(body, l)
        if nxt is not None:
            body, changed = nxt, True
    if changed:
        _write(path, body)


POINTER = ('- 교훈 스킬 — ', '- lesson skills — ')


def with_pointer(body, line):
    """CLAUDE.local.md 교훈 칸 머리 바로 아래의 스킬 목록 줄을 line 으로 바꾼다(None 이면 뺀다). 교훈 칸이 없으면 None.
    워크트리 세션은 gitignore 된 스킬을 목록에 못 보지만 부모 폴더 CLAUDE.local.md 는 읽는다 — 사람이 직접 켠 세션의 길"""
    lines = body.split('\n')
    start = next((i for i, l in enumerate(lines) if l.startswith('## 교훈') or l.startswith('## Lessons')), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
    keep = [l for l in lines[start + 1:end] if not l.startswith(POINTER)]
    return '\n'.join(lines[:start + 1] + ([line] if line else []) + keep + lines[end:])


def _sync_pointer(env, project):
    path = os.path.join(env.dev, project, 'CLAUDE.local.md')
    body = _read(path)
    if not body:
        return
    live = skill_lines(env, project)
    nxt = with_pointer(body, '- ' + live[0] if live else None)
    if nxt is not None and nxt != body:
        _write(path, nxt)


def _archive(env, project, title, lessons):
    path = os.path.join(env.lessons, '_archive', f'{project}.md')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        f.write(f'\n## {title}\n' + ''.join(f'- {l}\n' for l in lessons))


def _record(env, rec):
    os.makedirs(env.lessons, exist_ok=True)
    with open(os.path.join(env.lessons, 'skills.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')


def _check_project(env, project):
    T = env.T
    if not project or project in GLOBAL or '/' in project or '..' in project:
        raise Refuse(T(f'{project}: 프로젝트 교훈만 스킬로 묶어(공통·앱 공통 교훈은 아직 안 함)',
                       f'{project}: only project lessons can become skills (shared lessons are not supported yet)'))


# ── 명령 ──

def review(env, project):
    T = env.T
    _check_project(env, project)
    lines = _lines(env, project)
    act = active_skills(env, project)
    out = [T(f'{project} 교훈 {len(lines)}줄 · 지시마다 붙는 글 {send_chars(T, lines):,}자',
             f'{project}: {len(lines)} lessons · {send_chars(T, lines):,} characters on every instruction')]
    if act:
        out.append(T('이미 묶은 스킬(같은 주제면 이 이름으로 덧붙여):', 'skills already made (same topic → reuse the name to append):'))
        out += [f'  {n} ({len(s["lines"])}줄) — {s["desc"]}' for n, s in act.items()]
    out += [f'{i}. {l}' for i, l in enumerate(lines, 1)]
    out.append(T(
        '\n알아서 묶는 법(읽기만 했다 — 아직 아무것도 안 바뀜). 사람에게 묻지 않는다 — 되돌릴 수 있다:\n'
        '- 같은 주제(같은 도구·같은 화면·같은 함정 종류) 줄끼리 묶어. 새 스킬 하나 = 한 주제, 5~25줄(최소 3줄). 매 지시에 꼭 필요한 짧은 원칙은 남겨 둔다\n'
        '- 이미 묶은 스킬과 같은 주제면 새 스킬 말고 같은 이름으로 — 덧붙는다(--desc 는 안 줘도 됨)\n'
        '- 묶음마다: scripts/task lesson-group <프로젝트> <이름> --lines 3,7,12-15 --desc "<언제 열지 — 그 일을 할 때 쓰는 낱말들>"\n'
        '- 다 묶고 나면 사람에게는 각 명령이 마지막 줄에 찍어 주는 결과 한 줄만 전한다("~ 되돌리려면 말해")\n'
        '- 끝난 할 일·중복은 버리기 — 이것만 사람에게 카드로 묻는다: scripts/task lesson-drop <프로젝트> --lines 5,9 --why "<왜 버리자는지>" → 답이 오면 lesson-promote <task id>\n'
        '- 되돌리기: scripts/task lesson-restore <프로젝트> <이름>',
        '\nHow to group on your own (read-only so far — nothing changed). Do not ask the user — it is reversible:\n'
        '- Group lines on one topic (same tool, same screen, same kind of pitfall). One new skill = one topic, 5–25 lines (3 at least). Keep short rules every instruction needs\n'
        '- If a skill above already covers the topic, reuse its name instead of a new skill — the lines are appended (--desc is optional)\n'
        '- Per group: scripts/task lesson-group <project> <name> --lines 3,7,12-15 --desc "<when to open it — the words that work uses>"\n'
        '- When done, tell the user only the one-line result each command prints last ("… say so to undo")\n'
        '- Finished to-dos and duplicates are discarded — only this goes to the user as a card: scripts/task lesson-drop <project> --lines 5,9 --why "<why discard>" → when the answer comes: lesson-promote <task id>\n'
        '- Undo: scripts/task lesson-restore <project> <name>'))
    return '\n'.join(out)


def propose(env, project, raw_name, picks, desc):
    T = env.T
    _check_project(env, project)
    try:
        name = skill_name(raw_name)
    except ValueError:
        raise Refuse(T(f'스킬 이름이 이상해: {raw_name} — 영문 소문자·숫자·- 만(예: tauri-dev)', f'Bad skill name: {raw_name} — lowercase letters, digits and - only (e.g. tauri-dev)'))
    desc = ' '.join((desc or '').split())
    if not desc or len(desc) > 300:
        raise Refuse(T('--desc "<언제 열지>" 가 필요해(300자 안)', '--desc "<when to open it>" is required (under 300 characters)'))
    lines = _lines(env, project)
    try:
        nums = parse_picks(picks, len(lines))
    except ValueError:
        raise Refuse(T(f'줄 번호가 이상해: {picks} — 1~{len(lines)} 사이, 예: 3,7,12-15', f'Bad line numbers: {picks} — 1 to {len(lines)}, e.g. 3,7,12-15'))
    d = _skill_dir(env, project, name)
    act = active_skills(env, project)
    if os.path.exists(d) and name not in act:
        raise Refuse(T(f'{d} 는 우리가 만든 스킬이 아니야 — 다른 이름으로', f'{d} was not made by us — pick another name'))
    picked = [lines[i - 1] for i in nums]
    before = send_chars(T, picked)
    # 스킬 줄은 프로젝트에 한 줄 — 첫 스킬이면 머리째, 그다음부턴 ' / 이름: 설명' 만 늘어난다
    first = not any(os.path.exists(s['path']) for s in act.values())
    head = len(T(*SEND_HEAD)) + len(skills_line(T, os.path.dirname(d), [])) + 1 if first else 3
    after = 0 if name in act else head + len(skill_entry(name, desc))
    tid = datetime.datetime.now().strftime('%m%d-%H%M-') + os.urandom(2).hex()
    more = T(f'\n… 외 {len(picked) - PREVIEW}줄', f'\n… and {len(picked) - PREVIEW} more') if len(picked) > PREVIEW else ''
    cut = lambda s: s if len(s) <= 90 else s[:89] + '…'
    note = T(f'{project} 교훈 {len(picked)}줄을 `{name}` 스킬로 묶을까? 지시마다 붙는 글 {before:,}자 → {after:,}자'
             + (' (있는 스킬에 더함)' if name in act else '') + f'\n언제 열리나: {desc}\n',
             f'Group {len(picked)} {project} lessons into the `{name}` skill? Text on every instruction {before:,} → {after:,} characters'
             + (' (adds to an existing skill)' if name in act else '') + f'\nOpens when: {desc}\n') \
        + ''.join(f'- {cut(l)}\n' for l in picked[:PREVIEW]).rstrip('\n') + more \
        + T('\n답: 묶어 / 그대로 둬 / 버려(끝난 일·중복) / 다시 묶어', '\nAnswer: group it / keep as is / discard (done or duplicate) / regroup')
    send = {'ts': env.now(), 'type': 'send', 'task': tid, 'target': T(f'{project} 교훈', f'{project} lessons'),
            'title': T(f'교훈 묶기 — {project} → {name}', f'Group lessons — {project} → {name}'), 'project': project,
            'lesson': {'project': project, 'skill': name, 'desc': desc, 'lines': picked}}
    ask = {'ts': env.now(), 'type': 'ask', 'task': tid, 'note': note}
    if env.me:
        send['from'] = env.me
        ask['to'] = env.me
    env.append(send)
    env.append(ask)
    return tid, note


def _proposal(env, tid):
    T = env.T
    send = ask = answer = None
    done = False
    for e in _events(env):
        if e.get('task') != tid:
            continue
        t = e.get('type')
        if t == 'send' and e.get('lesson'):
            send = e
        elif t == 'ask':
            ask, answer = e, None
        elif t == 'answer' and ask:
            answer = e
        elif t == 'done':
            done = True
    if not send:
        raise Refuse(T(f'{tid}: 교훈 묶기 제안이 아니야(lesson-propose 로 만든 task id 를 줘)', f'{tid}: not a lesson proposal (use the task id from lesson-propose)'))
    if done:
        raise Refuse(T(f'{tid}: 이미 처리한 제안이야', f'{tid}: this proposal was already handled'))
    if not answer:
        raise Refuse(T(f'{tid}: 사람이 아직 카드에 답하지 않았어 — 답이 오면 다시', f'{tid}: the user has not answered the card yet — try again after they do'))
    return send['lesson'], (answer.get('note') or '').strip()


def _apply(env, project, name, desc, wanted, tid, drop):
    """고른 줄을 스킬로 옮기거나(drop 이면 archive 만) 버린다 — promote(사람 답 뒤)와 group(바로)가 같이 쓴다.
    → (옮긴 줄, 스킬 경로, 이미 없던 줄 수, 덧붙였나)"""
    T = env.T
    have = _lines(env, project)
    lessons = [l for l in wanted if l in have]
    gone = [l for l in wanted if l not in have]
    if not lessons:
        raise Refuse(T('고른 줄이 교훈 파일에 하나도 없어(이미 옮겼거나 지워짐)', 'None of the chosen lines are in the lesson file any more'))
    root = os.path.join(env.dev, project)
    d = _skill_dir(env, project, name or 'x')
    path = '' if drop else os.path.join(d, 'SKILL.md')
    stamp = env.now()[:10]
    appended = False
    if not drop:
        if not os.path.isdir(root):
            raise Refuse(T(f'프로젝트 폴더가 없어: {root}', f'Project folder not found: {root}'))
        act = active_skills(env, project)
        if os.path.exists(d) and name not in act:
            raise Refuse(T(f'{d} 는 우리가 만든 스킬이 아니야', f'{d} was not made by us'))
        ensure_ignored(env, root, os.path.relpath(path, root))
        appended = name in act
        old = _skill_lessons(_read(path)) if appended else []
        _write(path, skill_body(T, name, desc, project, old + [l for l in lessons if l not in old], f'{stamp}, task {tid}'))
    # 기록부터 남기고 옮긴다 — 옮기다 멈추면 기록을 보고 되돌릴 수 있게
    _record(env, {'ts': env.now(), 'action': 'drop' if drop else 'promote', 'project': project, 'skill': name or '',
                  'desc': desc, 'path': path, 'task': tid, 'lines': lessons})
    _archive(env, project, T(f'{stamp} {"버림" if drop else "→ " + name} (task {tid})', f'{stamp} {"discarded" if drop else "→ " + name} (task {tid})'), lessons)
    src = os.path.join(env.lessons, f'{project}.md')
    text, _ = remove_lines(_read(src), lessons)
    _write(src, text)
    _unmirror(env, project, lessons)
    _sync_pointer(env, project)
    return lessons, path, len(gone), appended


def _result(env, project, lessons, path, gone, drop):
    T = env.T
    left = _lines(env, project)
    msg = T(f'{len(lessons)}줄 ' + ('버림(archive)' if drop else f'→ {path}') + f' · 남은 교훈 {len(left)}줄({send_chars(T, left):,}자)',
            f'{len(lessons)} lines ' + ('discarded (archived)' if drop else f'→ {path}') + f' · {len(left)} lessons left ({send_chars(T, left):,} characters)')
    if gone:
        msg += T(f' · 이미 없던 줄 {gone}개는 건너뜀', f' · skipped {gone} lines that were already gone')
    return msg


def promote(env, tid, drop=False):
    """카드(lesson-propose·lesson-drop)에 사람이 답한 뒤 옮긴다. 버리기 카드면 --drop 없이도 버린다"""
    T = env.T
    prop, said = _proposal(env, tid)
    drop_card = bool(prop.get('drop'))
    if drop and not drop_card and not DROP.search(said):
        raise Refuse(T(f'사람 답이 "{said}" 라 버리지 않아 — 버리기는 사람이 버리라고 했을 때만', f'The user answered "{said}", so not discarding — only when they said to discard'))
    drop = drop or drop_card
    if NO.search(said) or (not drop and DROP.search(said)):
        hint = T(' — 버리라고 했으면 --drop', ' — if they said discard, use --drop') if DROP.search(said) and not drop else ''
        raise Refuse(T(f'사람 답이 "{said}" 라 {"버리지" if drop else "묶지"} 않아{hint}. 그대로 둘 거면 scripts/task done {tid} "<답>"',
                       f'The user answered "{said}", so not {"discarding" if drop else "grouping"}{hint}. To leave it: scripts/task done {tid} "<answer>"'))
    project = prop['project']
    _check_project(env, project)
    lessons, path, gone, _ = _apply(env, project, prop.get('skill'), prop.get('desc', ''), prop['lines'], tid, drop)
    msg = _result(env, project, lessons, path, gone, drop)
    env.append({'ts': env.now(), 'type': 'done', 'task': tid, 'note': msg})
    return msg


def group(env, project, raw_name, picks, desc):
    """사람 답 없이 바로 스킬로 묶는다(2026-10-08) → (자세한 결과, 사람에게 전할 한 줄).
    이미 우리가 만든 스킬이면 덧붙인다 — 새 스킬 남발 방지"""
    T = env.T
    _check_project(env, project)
    try:
        name = skill_name(raw_name)
    except ValueError:
        raise Refuse(T(f'스킬 이름이 이상해: {raw_name} — 영문 소문자·숫자·- 만(예: tauri-dev)', f'Bad skill name: {raw_name} — lowercase letters, digits and - only (e.g. tauri-dev)'))
    lines = _lines(env, project)
    try:
        nums = parse_picks(picks, len(lines))
    except ValueError:
        raise Refuse(T(f'줄 번호가 이상해: {picks} — 1~{len(lines)} 사이, 예: 3,7,12-15', f'Bad line numbers: {picks} — 1 to {len(lines)}, e.g. 3,7,12-15'))
    act = active_skills(env, project)
    desc = ' '.join((desc or '').split())
    if name in act:
        desc = desc or act[name]['desc']
    elif not desc or len(desc) > 300:
        raise Refuse(T('새 스킬엔 --desc "<언제 열지>" 가 필요해(300자 안)', 'A new skill needs --desc "<when to open it>" (under 300 characters)'))
    elif len(nums) < MIN_NEW:
        raise Refuse(T(f'새 스킬은 최소 {MIN_NEW}줄부터야({len(nums)}줄) — 이미 묶은 스킬에 덧붙이거나 줄을 더 모아 줘',
                       f'A new skill needs at least {MIN_NEW} lines (got {len(nums)}) — append to an existing skill or gather more lines'))
    if len(desc) > 300:
        raise Refuse(T('--desc 는 300자 안', '--desc must be under 300 characters'))
    tid = 'auto-' + datetime.datetime.now().strftime('%m%d-%H%M-') + os.urandom(2).hex()
    lessons, path, gone, appended = _apply(env, project, name, desc, [lines[i - 1] for i in nums], tid, False)
    detail = _result(env, project, lessons, path, gone, False)
    report = T(f'{project} 교훈 {len(lessons)}줄을 {name} 스킬로 {"덧붙였어" if appended else "묶었어"} — 되돌리려면 말해',
               f'{len(lessons)} {project} lessons {"appended to" if appended else "grouped into"} the {name} skill — say so to undo it')
    return detail, report


def drop_card(env, project, picks, why):
    """버릴까? 카드 — 버리기는 사람이 정한다(끝난 일인지 아직 쓸모 있는지는 사람이 안다)"""
    T = env.T
    _check_project(env, project)
    lines = _lines(env, project)
    try:
        nums = parse_picks(picks, len(lines))
    except ValueError:
        raise Refuse(T(f'줄 번호가 이상해: {picks} — 1~{len(lines)} 사이, 예: 3,7,12-15', f'Bad line numbers: {picks} — 1 to {len(lines)}, e.g. 3,7,12-15'))
    why = ' '.join((why or '').split())[:200]
    picked = [lines[i - 1] for i in nums]
    tid = datetime.datetime.now().strftime('%m%d-%H%M-') + os.urandom(2).hex()
    more = T(f'\n… 외 {len(picked) - PREVIEW}줄', f'\n… and {len(picked) - PREVIEW} more') if len(picked) > PREVIEW else ''
    cut = lambda s: s if len(s) <= 90 else s[:89] + '…'
    note = T(f'{project} 교훈 {len(picked)}줄을 버릴까?' + (f' {why}' if why else '') + '\n',
             f'Discard {len(picked)} {project} lessons?' + (f' {why}' if why else '') + '\n') \
        + ''.join(f'- {cut(l)}\n' for l in picked[:PREVIEW]).rstrip('\n') + more \
        + T('\n답: 버려 / 그대로 둬 (버려도 원본은 archive 에 남아)', '\nAnswer: discard / keep (originals stay in the archive either way)')
    send = {'ts': env.now(), 'type': 'send', 'task': tid, 'target': T(f'{project} 교훈', f'{project} lessons'),
            'title': T(f'교훈 버리기 — {project} {len(picked)}줄', f'Discard lessons — {project} {len(picked)}'), 'project': project,
            'lesson': {'project': project, 'skill': '', 'desc': why, 'lines': picked, 'drop': True}}
    ask = {'ts': env.now(), 'type': 'ask', 'task': tid, 'note': note}
    if env.me:
        send['from'] = env.me
        ask['to'] = env.me
    env.append(send)
    env.append(ask)
    return tid


def restore(env, project, raw_name):
    T = env.T
    _check_project(env, project)
    try:
        name = skill_name(raw_name)
    except ValueError:
        raise Refuse(T(f'스킬 이름이 이상해: {raw_name}', f'Bad skill name: {raw_name}'))
    act = active_skills(env, project)
    if name not in act:
        raise Refuse(T(f'{project} 에 우리가 만든 {name} 스킬이 없어 — 남이 만든 스킬은 안 건드린다',
                       f'{project} has no {name} skill made by us — skills made by others are left alone'))
    d = _skill_dir(env, project, name)
    lessons = _skill_lessons(_read(os.path.join(d, 'SKILL.md'))) or act[name]['lines']
    _record(env, {'ts': env.now(), 'action': 'restore', 'project': project, 'skill': name, 'lines': lessons})
    for l in lessons:
        env.add_lesson(project, l)
    if os.path.isdir(d):
        keep = os.path.join(env.lessons, '_archive', 'skills', project, f'{name}-{datetime.datetime.now().strftime("%Y%m%d-%H%M%S")}')
        os.makedirs(os.path.dirname(keep), exist_ok=True)
        shutil.move(d, keep)
    _sync_pointer(env, project)
    _archive(env, project, T(f'{env.now()[:10]} ← {name} 되돌림', f'{env.now()[:10]} ← {name} restored'), [])
    return T(f'{name} 되돌림 — 교훈 {len(lessons)}줄이 다시 지시에 붙는다', f'{name} restored — {len(lessons)} lessons ride on instructions again')


def nudge(env, project, n):
    """교훈이 많을 때 경고 끝에 붙일 길 — 참모가 알아서 묶고, 사람에겐 결과 한 줄만"""
    return env.T(f' — 사람에게 묻지 말고 네가 주제로 묶어: scripts/task lesson-review {project} 로 보고 lesson-group 으로 묶은 뒤, 사람에겐 결과 한 줄만(되돌릴 수 있고 버리기만 lesson-drop 카드)',
                 f' — do not ask the user, group them by topic yourself: look with scripts/task lesson-review {project}, group with lesson-group, then tell the user one line (reversible; only discarding goes through a lesson-drop card)')


def run(env, cmd, args):
    """scripts/task lesson-* 진입점 → 종료 코드. 출력은 stdout(결과)·stderr(거절 이유)"""
    import sys
    T = env.T
    usage = T('쓰는 법: lesson-review <프로젝트> | lesson-group <프로젝트> <이름> --lines 3,7-9 --desc "<언제 열지>" | lesson-drop <프로젝트> --lines 5 [--why "<이유>"] | lesson-promote <task id> | lesson-restore <프로젝트> <이름> | (사람에게 먼저 묻고 싶을 때) lesson-propose <프로젝트> <이름> --lines … --desc …',
              'usage: lesson-review <project> | lesson-group <project> <name> --lines 3,7-9 --desc "<when to open>" | lesson-drop <project> --lines 5 [--why "<reason>"] | lesson-promote <task id> | lesson-restore <project> <name> | (to ask the user first) lesson-propose <project> <name> --lines … --desc …')

    def opt(flag):
        return args[args.index(flag) + 1] if flag in args and args.index(flag) + 1 < len(args) else None
    try:
        if cmd == 'lesson-review' and len(args) >= 1:
            print(review(env, args[0]))
        elif cmd == 'lesson-group' and len(args) >= 2:
            detail, report = group(env, args[0], args[1], opt('--lines'), opt('--desc'))
            print(detail)
            print(report)
        elif cmd == 'lesson-drop' and len(args) >= 1:
            tid = drop_card(env, args[0], opt('--lines'), opt('--why'))
            print(tid)
            print(T('결정 대기함에 버릴까 카드 올림 — 사람이 답하면 scripts/task lesson-promote ', 'discard card posted to the decision inbox — when the user answers: scripts/task lesson-promote ') + tid, file=sys.stderr)
        elif cmd == 'lesson-propose' and len(args) >= 2:
            tid, note = propose(env, args[0], args[1], opt('--lines'), opt('--desc'))
            print(tid)
            print(T('결정 대기함에 카드 올림 — 사람이 답하면 scripts/task lesson-promote ', 'card posted to the decision inbox — when the user answers: scripts/task lesson-promote ') + tid, file=sys.stderr)
        elif cmd == 'lesson-promote' and len(args) >= 1:
            print(promote(env, args[0], drop='--drop' in args))
        elif cmd == 'lesson-restore' and len(args) >= 2:
            print(restore(env, args[0], args[1]))
        else:
            print(usage, file=sys.stderr)
            return 2
    except Refuse as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0

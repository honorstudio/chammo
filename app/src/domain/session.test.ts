import { afterEach, describe, expect, it } from 'vitest';
import { setAssistant, setLang } from '../i18n';
import { classifyWorkspace, closableByShortcut, groupByProject, projectDir, isOrchestratorName, nextOrchestratorName, orchView, parseAgents, type Session, withinRoots, sessionsToStop } from './session';

afterEach(() => { setLang('ko'); setAssistant(null); });

const DEV = '/Users/acme/Desktop/dev';

// `claude agents --json` 실물 모양 (2026-09-25). background는 id·state, interactive는 pid·status
const RAW = [
  { id: '270af8a2', cwd: `${DEV}/quest-game`, kind: 'background', startedAt: 1, sessionId: 's1', name: 'add-deduction-game-mode', state: 'blocked' },
  { pid: 6268, cwd: `${DEV}/honor-orchestrator`, kind: 'interactive', startedAt: 2, sessionId: 's2', name: 'honor-orchestrator-e7', status: 'busy' },
  { id: '7ce32610', cwd: `${DEV}/ops-hub/.claude/worktrees/oms`, kind: 'background', startedAt: 3, sessionId: 's3', name: 'oms', state: 'working' },
  { id: 'cd1de525', cwd: `${DEV}/todo-api`, kind: 'background', startedAt: 4, sessionId: 's4', name: 'spike-1', state: 'done' },
  { id: '9d43b05c', cwd: `${DEV}/ops-hub`, kind: 'background', startedAt: 5, sessionId: 's5', name: 'main', state: 'idle' },
];

describe('parseAgents — claude agents --json을 앱 세션으로', () => {
  it('background·interactive를 전부 읽는다', () => {
    expect(parseAgents(JSON.stringify(RAW), DEV)).toHaveLength(5);
  });

  it('state/status를 세 가지 앱 상태로 옮긴다', () => {
    const by = Object.fromEntries(parseAgents(JSON.stringify(RAW), DEV).map((s) => [s.name, s.state]));
    expect(by['oms']).toBe('working');                    // state: working
    expect(by['honor-orchestrator-e7']).toBe('working');  // status: busy
    expect(by['add-deduction-game-mode']).toBe('blocked');
    expect(by['spike-1']).toBe('idle');                   // done
    expect(by['main']).toBe('idle');
  });

  it('status가 있으면 state보다 우선한다 — 가져온 세션은 대기 중에도 state가 blocked로 나온다(실측)', () => {
    const raw = [
      { id: 'a1', cwd: `${DEV}/todo-api`, kind: 'background', state: 'blocked', status: 'idle', name: 'x' },
      { id: 'a2', cwd: `${DEV}/todo-api`, kind: 'background', state: 'working', status: 'busy', name: 'y' },
      { id: 'a3', cwd: `${DEV}/todo-api`, kind: 'background', state: 'blocked', name: 'z' },
    ];
    expect(parseAgents(JSON.stringify(raw), DEV).map((s) => s.state)).toEqual(['idle', 'working', 'blocked']);
  });

  // 2026-09-28: 백그라운드 감시·에이전트를 걸어 둔 참모는 답을 마치고 쉬어도(state: done) status 가 busy 로 남았다
  //  → '작업 중'으로 읽혀 음성 모드가 참모 답을 하나도 안 읽었다
  it('state 가 done 이면 status 가 busy 여도 쉬는 중 — 답은 끝났고 뒤에서 도는 작업만 있다', () => {
    const raw = [{ id: 'b5', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'done', status: 'busy', name: '참모-5' }];
    expect(parseAgents(JSON.stringify(raw), DEV)[0]!.state).toBe('idle');
  });

  it('id는 background의 짧은 id, interactive는 sessionId로 대신한다', () => {
    const s = parseAgents(JSON.stringify(RAW), DEV);
    expect(s.find((x) => x.name === 'oms')?.id).toBe('7ce32610');
    expect(s.find((x) => x.name === 'honor-orchestrator-e7')?.id).toBe('s2');
  });

  it('프로젝트·작업공간을 cwd에서 채운다', () => {
    const s = parseAgents(JSON.stringify(RAW), DEV);
    expect(s.find((x) => x.name === 'oms')).toMatchObject({ project: 'ops-hub', workspace: 'oms' });
    expect(s.find((x) => x.name === 'main')).toMatchObject({ project: 'ops-hub', workspace: null });
  });

  it('interactive는 pid, 둘 다 sessionId를 보존한다 — 앱으로 옮길 때 필요하다', () => {
    const s = parseAgents(JSON.stringify(RAW), DEV);
    expect(s.find((x) => x.name === 'honor-orchestrator-e7')).toMatchObject({ pid: 6268, procPid: 6268, sessionId: 's2' });
    expect(s.find((x) => x.name === 'oms')).toMatchObject({ pid: undefined, sessionId: 's3' });
  });

  it('JSON이 아니면 던진다 (조용히 빈 목록을 주면 원인이 묻힌다)', () => {
    expect(() => parseAgents('error: unknown option', DEV)).toThrow();
  });

  it('빈 배열은 빈 목록', () => {
    expect(parseAgents('[]', DEV)).toEqual([]);
  });
});

describe('classifyWorkspace — cwd → 프로젝트 / 작업공간', () => {
  it('프로젝트 본체는 workspace가 null', () => {
    expect(classifyWorkspace(`${DEV}/todo-api`, DEV)).toEqual({ project: 'todo-api', workspace: null });
  });

  it('.claude/worktrees/<이름> 은 그 프로젝트의 작업공간', () => {
    expect(classifyWorkspace(`${DEV}/ops-hub/.claude/worktrees/oms`, DEV)).toEqual({ project: 'ops-hub', workspace: 'oms' });
  });

  it('프로젝트 안 하위 폴더에서 띄운 세션은 본체로 본다', () => {
    expect(classifyWorkspace(`${DEV}/todo-api/src/features`, DEV)).toEqual({ project: 'todo-api', workspace: null });
  });

  it('형제 폴더 worktree(pixel_blog_app-icontest)는 git을 안 보면 알 수 없으니 별개 프로젝트로 둔다', () => {
    expect(classifyWorkspace(`${DEV}/pixel_blog_app-icontest`, DEV)).toEqual({ project: 'pixel_blog_app-icontest', workspace: null });
  });

  it('dev 밖 경로는 마지막 폴더명을 프로젝트로', () => {
    expect(classifyWorkspace('/tmp/scratch', DEV)).toEqual({ project: 'scratch', workspace: null });
  });

  it('끝에 슬래시가 붙어도 같다', () => {
    expect(classifyWorkspace(`${DEV}/todo-api/`, DEV)).toEqual({ project: 'todo-api', workspace: null });
  });
});

describe('classifyWorkspace — devRoot 밖에 따로 추가한 프로젝트 폴더(extraProjects)', () => {
  const EX = ['/Users/me/automation/blog-bot'];
  it('추가한 폴더 자체·그 안은 그 폴더 이름의 프로젝트', () => {
    expect(classifyWorkspace('/Users/me/automation/blog-bot', DEV, EX)).toEqual({ project: 'blog-bot', workspace: null });
    expect(classifyWorkspace('/Users/me/automation/blog-bot/content', DEV, EX)).toEqual({ project: 'blog-bot', workspace: null });
  });
  it('추가한 폴더의 worktree 는 작업공간', () => {
    expect(classifyWorkspace('/Users/me/automation/blog-bot/.claude/worktrees/fix', DEV, EX)).toEqual({ project: 'blog-bot', workspace: 'fix' });
  });
  it('이름만 비슷한 옆 폴더는 아니다', () => {
    expect(classifyWorkspace('/Users/me/automation/blog-bot-old', DEV, EX)).toEqual({ project: 'blog-bot-old', workspace: null });
  });
  it('devRoot 안 폴더는 그대로', () => {
    expect(classifyWorkspace(`${DEV}/todo-api`, DEV, EX)).toEqual({ project: 'todo-api', workspace: null });
  });
});

describe('projectDir — 프로젝트 이름 → 폴더', () => {
  it('따로 추가한 폴더면 그 경로, 아니면 devRoot 아래', () => {
    expect(projectDir('blog-bot', DEV, ['/Users/me/automation/blog-bot/'])).toBe('/Users/me/automation/blog-bot');
    expect(projectDir('todo-api', DEV, ['/Users/me/automation/blog-bot'])).toBe(`${DEV}/todo-api`);
    expect(projectDir('todo-api', `${DEV}/`)).toBe(`${DEV}/todo-api`);
  });
});

describe('groupByProject — 사이드바용 묶기', () => {
  // 2026-09-28 아이맥: 5분마다 도는 자동 실행이 project-x 폴더에 Claude 를 띄워, project-x 에 열리지도 않는 세션이 떠 있었다
  it('예약 작업이 아무도 안 보는 곳에서 띄운 대화형 세션은 프로젝트에서 빼고 external 로', () => {
    const cron: Session = { id: 's9', name: 'project-x-cb', cwd: `${DEV}/todo-api`, kind: 'interactive', state: 'idle', project: 'todo-api', workspace: null, startedAt: 0, origin: { unattended: true, via: 'tmux claude' } };
    const mine: Session = { ...cron, id: 's8', name: 'mine', origin: { unattended: false, via: 'iTerm2' } };
    const g = groupByProject([cron, mine], `${DEV}/honor-orchestrator`);
    expect(g.external.map((x) => x.id)).toEqual(['s9']);
    expect(g.projects.flatMap((p) => p.sessions).map((x) => x.id)).toEqual(['s8']);
  });

  const sessions: Session[] = parseAgents(JSON.stringify(RAW), DEV);

  it('오케스트레이터(이 앱 폴더의 세션)는 따로 빼고, 나머지를 프로젝트별로 묶는다', () => {
    const g = groupByProject(sessions, `${DEV}/honor-orchestrator`);
    expect(g.orchestrator?.name).toBe('honor-orchestrator-e7');
    expect(g.projects.map((p) => p.name)).toEqual(['quest-game', 'ops-hub', 'todo-api']);
  });

  it('한 프로젝트의 세션은 들어온 순서를 지킨다 (상태 점 순서)', () => {
    const g = groupByProject(sessions, `${DEV}/honor-orchestrator`);
    expect(g.projects.find((p) => p.name === 'ops-hub')?.sessions.map((s) => s.workspace)).toEqual(['oms', null]);
  });

  it('이 폴더의 비서 이름 세션(참모·참모-2…)은 전부 비서 — 이름이 "참모"인 게 맨 앞(대표)', () => {
    const two = parseAgents(JSON.stringify([
      { id: 'x1', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'blocked', status: 'idle', name: '참모-2' },
      { id: 'x2', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: '참모' },
      { id: 'x3', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: '참모-3' },
    ]), DEV);
    const g = groupByProject(two, `${DEV}/honor-orchestrator`);
    expect(g.orchestrator?.id).toBe('x2');
    expect(g.orchestrators.map((s) => s.id)).toEqual(['x2', 'x1', 'x3']);
    expect(g.helpers).toEqual([]);
    expect(g.projects).toEqual([]);
  });

  it('비서 폴더에서 도는 다른 이름의 백그라운드 세션은 도우미 — 비서 화면에 끼지 않는다(사용자 2026-09-28: 올리기 도우미가 참모 칸을 차지)', () => {
    const xs = parseAgents(JSON.stringify([
      { id: 'b1', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: '참모' },
      { id: 'h1', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: 'launch-post' },
      { pid: 7, cwd: `${DEV}/honor-orchestrator`, kind: 'interactive', status: 'busy', name: 'honor-orchestrator-e7' },
    ]), DEV);
    const g = groupByProject(xs, `${DEV}/honor-orchestrator`);
    expect(g.orchestrators.map((s) => s.name)).toEqual(['참모', 'honor-orchestrator-e7']); // 터미널에서 연 대화형은 비서 그대로
    expect(g.helpers.map((s) => s.id)).toEqual(['h1']);
    expect(g.projects).toEqual([]);
  });

  it('설정 이름(assistant)이 옛 이름 "참모"보다 먼저 대표가 된다', () => {
    setAssistant('두목');
    const xs = parseAgents(JSON.stringify([
      { id: 'a', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: '참모' },
      { id: 'b', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: '두목' },
    ]), DEV);
    expect(groupByProject(xs, `${DEV}/honor-orchestrator`).orchestrator?.id).toBe('b');
  });

  it('기본 이름(참모)이 대표 — 옛 이름 세션이 없어도', () => {
    const xs = parseAgents(JSON.stringify([
      { id: 'a', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: 'misc' },
      { id: 'b', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: '참모' },
    ]), DEV);
    expect(groupByProject(xs, `${DEV}/honor-orchestrator`).orchestrator?.id).toBe('b');
  });

  it('오케스트레이터 세션이 없으면 undefined, 목록은 빈 배열', () => {
    const g = groupByProject(sessions.filter((s) => s.kind !== 'interactive'), `${DEV}/honor-orchestrator`);
    expect(g.orchestrator).toBeUndefined();
    expect(g.orchestrators).toEqual([]);
    expect(g.projects).toHaveLength(3);
  });
});

describe('nextOrchestratorName — ⌘T로 비서를 하나 더 띄울 때 이름(assistant() 기준)', () => {
  it('기본 이름은 참모 — 없으면 참모, 있으면 참모-2, 빈 번호가 아니라 다음 번호', () => {
    expect(nextOrchestratorName([])).toBe('참모');
    expect(nextOrchestratorName(['참모'])).toBe('참모-2');
    expect(nextOrchestratorName(['참모', '참모-3'])).toBe('참모-4');
  });

  it('설정 이름이 참모면 참모-2 로 이어진다(기존 세션 그대로)', () => {
    setAssistant('참모');
    expect(nextOrchestratorName([])).toBe('참모');
    expect(nextOrchestratorName(['참모'])).toBe('참모-2');
    expect(nextOrchestratorName(['참모', '참모-3'])).toBe('참모-4');
  });

  it('영어 기본 이름은 Chammo', () => {
    setLang('en');
    expect(nextOrchestratorName(['Chammo'])).toBe('Chammo-2');
  });

  it('정규식 글자가 든 이름도 그대로 센다', () => {
    setAssistant('a.b');
    expect(nextOrchestratorName(['a.b', 'axb-5'])).toBe('a.b-2');
  });

  it('다른 이름은 세지 않는다', () => {
    expect(nextOrchestratorName(['session-management-setup'])).toBe('참모');
  });
});

describe('isOrchestratorName — 설정 이름과 옛 이름 둘 다 비서', () => {
  it('참모(기본)·참모(옛 이름)는 비서, 참모-2·다른 이름은 대표 이름이 아니다', () => {
    expect(isOrchestratorName('참모')).toBe(true);
    expect(isOrchestratorName('참모')).toBe(true);
    expect(isOrchestratorName('참모-2')).toBe(false);
    expect(isOrchestratorName('misc')).toBe(false);
  });
});

describe('상태 — 권한 창·선택지에서 멈춘 세션', () => {
  it('status: waiting(permission prompt·input needed)은 확인창(blocked)으로 — 대기(idle)가 아니다', () => {
    const [x] = parseAgents(JSON.stringify([{ id: 'w1', cwd: `${DEV}/acme-shop`, kind: 'background', state: 'blocked', status: 'waiting', waitingFor: 'permission prompt', name: 'acme-shop' }]), DEV);
    expect(x?.state).toBe('blocked');
  });
});

describe('waitingFor — 무엇에 막혔나', () => {
  it('권한 창·선택지 구분을 그대로 들고 온다', () => {
    const xs = parseAgents(JSON.stringify([
      { id: 'p', cwd: `${DEV}/acme-shop`, kind: 'background', state: 'blocked', status: 'waiting', waitingFor: 'permission prompt', name: 'acme-shop' },
      { id: 'q', cwd: `${DEV}/todo-api`, kind: 'background', state: 'blocked', status: 'waiting', waitingFor: 'input needed', name: 'todo-api' },
    ]), DEV);
    expect(xs.map((x) => x.waitingFor)).toEqual(['permission prompt', 'input needed']);
  });

  it('status 없이 state: blocked 만 있으면 시작 권한 창(새 MCP 서버 등) — startup prompt', () => {
    const [x] = parseAgents(JSON.stringify([{ id: 's', cwd: `${DEV}/todo-api`, kind: 'background', state: 'blocked', name: 'todo-api' }]), DEV);
    expect(x?.waitingFor).toBe('startup prompt');
    expect(x?.state).toBe('blocked');
  });
});

describe('orchView — 참모 화면을 무엇으로 그리나', () => {
  const o = (kind: Session['kind'], name = '참모') => ({ id: name, kind, name }) as Session;
  it('참모가 없으면 띄우기 버튼', () => expect(orchView([])).toBe('empty'));
  // 재현(2026-09-27 사용자 "창이 두 개 이상이어야 메모가 된다"): 하나일 땐 메모가 안 붙은 맨 터미널을 그렸다
  it('백그라운드 참모 하나여도 격자로 — 메모(머리줄·⌘M)·창 버튼이 여럿일 때와 같게 붙는다', () =>
    expect(orchView([o('background')])).toBe('grid'));
  it('여럿이면 격자', () => expect(orchView([o('background'), o('background', '참모-2')])).toBe('grid'));
  it('터미널에서 연 참모 하나는 가져오기 카드', () => expect(orchView([o('interactive')])).toBe('adopt'));
});

describe('withinRoots — 내 프로젝트 폴더·HQ 안의 세션만(다른 데서 띄운 세션은 안 보인다)', () => {
  const S = (cwd: string) => ({ cwd }) as unknown as Session;
  it('루트 안(하위 폴더·worktree 포함)만 남긴다, 이름만 비슷한 옆 폴더는 뺀다', () => {
    const list = [S('/u/dev/shop'), S('/u/dev/shop/.claude/worktrees/x'), S('/u/hq'), S('/u/other/app'), S('/u/dev-old/x')];
    expect(withinRoots(list, ['/u/dev', '/u/hq/']).map((s) => s.cwd)).toEqual(['/u/dev/shop', '/u/dev/shop/.claude/worktrees/x', '/u/hq']);
  });
  it('루트가 비면 거르지 않는다', () => {
    expect(withinRoots([S('/a')], [])).toHaveLength(1);
  });
});

describe('sessionsToStop — "세션도 모두 끄고 끄기"가 끌 세션(사용자 2026-09-28: ⌘Q 해도 뒤에서 돌았다)', () => {
  const s = (id: string, cwd: string) => ({ id, cwd });
  it('Chammo 가 다루는 것(프로젝트 폴더·HQ 안)만, 다른 데서 띄운 세션은 안 끈다', () =>
    expect(sessionsToStop([s('a', '/dev/acme'), s('b', '/hq'), s('c', '/elsewhere/x')], ['/dev', '/hq']).map((x) => x.id)).toEqual(['a', 'b']));
  it('폴더를 모르면 아무것도 안 끈다(전부 끄는 쪽으로 틀리지 않게)', () => expect(sessionsToStop([s('a', '/dev/acme')], ['', ''])).toEqual([]));
});

describe('closableByShortcut — ⌘W 로 끌 수 있나(사용자 2026-09-28: 리더 탭 닫으려던 ⌘W 에 참모-2 가 꺼졌다)', () => {
  const xs = parseAgents(JSON.stringify([
    { id: 'b1', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: '참모' },
    { id: 'b2', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: '참모-2' },
    { id: 'h1', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'working', name: 'launch-post' },
    { id: 'p1', cwd: `${DEV}/todo-api`, kind: 'background', state: 'working', name: 'fix' },
  ]), DEV);
  const g = groupByProject(xs, `${DEV}/honor-orchestrator`);
  it('비서는 번호가 붙어도 안 된다', () => {
    expect(closableByShortcut(xs[0]!, g.orchestrators)).toBe(false);
    expect(closableByShortcut(xs[1]!, g.orchestrators)).toBe(false);
  });
  it('도우미·프로젝트 세션은 된다', () => {
    expect(closableByShortcut(xs[2]!, g.orchestrators)).toBe(true);
    expect(closableByShortcut(xs[3]!, g.orchestrators)).toBe(true);
  });
});

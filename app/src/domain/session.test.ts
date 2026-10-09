import { afterEach, describe, expect, it } from 'vitest';
import { assistant, setAssistant, setLang } from '../i18n';
import appSrc from '../App.tsx?raw';
import { appRoots, classifyWorkspace, closableByShortcut, groupByProject, projectDir, isOrchestratorName, nextOrchestratorName, orchView, parseAgents, type Session, toolsWay, withinRoots, sessionsToStop } from './session';

afterEach(() => { setLang('ko'); setAssistant(null); });

const DEV = '/Users/acme/Desktop/dev';

// `claude agents --json` 실물 모양 (2026-09-25). background는 id·state, interactive는 pid·status
const RAW = [
  { id: 'face0005', cwd: `${DEV}/quest-game`, kind: 'background', startedAt: 1, sessionId: 's1', name: 'add-deduction-game-mode', state: 'blocked' },
  { pid: 6268, cwd: `${DEV}/honor-orchestrator`, kind: 'interactive', startedAt: 2, sessionId: 's2', name: 'honor-orchestrator-e7', status: 'busy' },
  { id: '1a2b3c4d', cwd: `${DEV}/ops-hub/.claude/worktrees/oms`, kind: 'background', startedAt: 3, sessionId: 's3', name: 'oms', state: 'working' },
  { id: 'cafe0006', cwd: `${DEV}/todo-api`, kind: 'background', startedAt: 4, sessionId: 's4', name: 'spike-1', state: 'done' },
  { id: '5e6f7a8b', cwd: `${DEV}/ops-hub`, kind: 'background', startedAt: 5, sessionId: 's5', name: 'main', state: 'idle' },
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

  // 2026-09-30: Claude Code 는 턴을 끝내고 사람 답을 기다리면 status idle + state blocked(권한 창 이유 없음), 일을 끝냈으면 done 으로 준다
  it('쉬는데 state 가 blocked(이유 없음)면 사람 답 기다림 표시', () => {
    const raw = [
      { id: 'w1', cwd: `${DEV}/todo-api`, kind: 'background', state: 'blocked', status: 'idle', name: 'x' },
      { id: 'w2', cwd: `${DEV}/todo-api`, kind: 'background', state: 'done', status: 'idle', name: 'y' },
      { id: 'w3', cwd: `${DEV}/todo-api`, kind: 'background', state: 'blocked', status: 'idle', waitingFor: 'input needed', name: 'z' },
    ];
    expect(parseAgents(JSON.stringify(raw), DEV).map((s) => !!s.awaiting)).toEqual([true, false, false]);
  });

  // 2026-09-28: 백그라운드 감시·에이전트를 걸어 둔 참모는 답을 마치고 쉬어도(state: done) status 가 busy 로 남았다
  //  → '작업 중'으로 읽혀 음성 모드가 참모 답을 하나도 안 읽었다
  it('state 가 done 이면 status 가 busy 여도 쉬는 중 — 답은 끝났고 뒤에서 도는 작업만 있다', () => {
    const raw = [{ id: 'b5', cwd: `${DEV}/honor-orchestrator`, kind: 'background', state: 'done', status: 'busy', name: '참모-5' }];
    expect(parseAgents(JSON.stringify(raw), DEV)[0]!.state).toBe('idle');
  });

  it('id는 background의 짧은 id, interactive는 sessionId로 대신한다', () => {
    const s = parseAgents(JSON.stringify(RAW), DEV);
    expect(s.find((x) => x.name === 'oms')?.id).toBe('1a2b3c4d');
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

// 아이맥 ~/automation/project-x 을 따로 추가했는데, 그 저장소(~/automation) 워크트리로 들어간 세션이 사이드바·대시보드에서 사라졌다(2026-10-05 fix/direct-visible)
describe('따로 추가한 폴더가 저장소 하위 폴더일 때 — 그 저장소 워크트리 세션', () => {
  const EX = ['/Users/acme/automation/project-x'];
  const WT = '/Users/acme/automation/.claude/worktrees/fix';
  it('워크트리 꼭대기에서 도는 세션은 추가 폴더 이름의 프로젝트, 작업공간은 워크트리', () => {
    expect(classifyWorkspace(WT, DEV, EX)).toEqual({ project: 'project-x', workspace: 'fix' });
  });
  it('워크트리 안 같은 하위 폴더에서 도는 세션도', () => {
    expect(classifyWorkspace(`${WT}/project-x/src`, DEV, EX)).toEqual({ project: 'project-x', workspace: 'fix' });
  });
  it('같은 저장소에 추가 폴더가 둘이면 워크트리 안 자리로 고른다', () => {
    const two = ['/Users/acme/automation/project-x', '/Users/acme/automation/eta-bot'];
    expect(classifyWorkspace(`${WT}/eta-bot`, DEV, two)).toEqual({ project: 'eta-bot', workspace: 'fix' });
    expect(classifyWorkspace(WT, DEV, two)).toEqual({ project: 'project-x', workspace: 'fix' });
  });
  it('홈·루트의 .claude/worktrees 는 저장소로 안 친다(홈 아래 추가 폴더가 남의 세션을 끌어오지 않게)', () => {
    expect(classifyWorkspace('/Users/acme/.claude/worktrees/x', DEV, ['/Users/acme/blog'])).toEqual({ project: 'x', workspace: null });
    expect(classifyWorkspace('C:/Users/Me/.claude/worktrees/x', 'C:/Users/Me/dev', ['C:/Users/Me/blog']).project).toBe('x');
  });
  it('devRoot 안 저장소의 워크트리는 지금처럼 그 저장소 프로젝트', () => {
    expect(classifyWorkspace(`${DEV}/shop/.claude/worktrees/w`, DEV, [`${DEV}/shop/web`])).toEqual({ project: 'shop', workspace: 'w' });
  });
  it('appRoots 로 거르면 워크트리 세션이 남고, 저장소의 다른 폴더·홈 워크트리는 빠진다', () => {
    const S = (cwd: string) => ({ cwd }) as unknown as Session;
    const list = [S(WT), S(`${WT}/project-x`), S('/Users/acme/automation/other'), S('/Users/acme/.claude/worktrees/x'), S('/Users/acme/automation/project-x')];
    expect(withinRoots(list, appRoots(DEV, '/Users/acme/hq', EX)).map((s) => s.cwd)).toEqual([WT, `${WT}/project-x`, '/Users/acme/automation/project-x']);
  });
  it('앱의 세 거름(살아 있는 것·꺼진 것·끌 것)이 appRoots 를 쓴다', () => {
    expect(appSrc.match(/appRoots\(/g)?.length).toBe(3);
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

describe('toolsWay — 위 막대 도구 아이콘을 어디에 띄우나', () => {
  it('스페이스가 떠 있으면 그 탭에', () => expect(toolsWay('adopt', true)).toBe('space'));
  it('터미널 뷰 격자·참모 0명이면 채팅 뷰로 넘어가 연다', () => {
    expect(toolsWay('grid', false)).toBe('switch');
    expect(toolsWay('empty', false)).toBe('switch');
  });
  // 재현(2026-10-05 fix/tools-topbar 부채 ①): 붙인 세션 하나(adopt)는 스페이스가 없어 아이콘이 아무것도 안 했다
  it('터미널 뷰 adopt 는 떠 있는 창으로(하니터처럼)', () => expect(toolsWay('adopt', false)).toBe('float'));
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
  it('윈도우는 대소문자·구분자가 달라도 같은 폴더 — 대소문자만 다른 HQ 세션이 앱에서 통째로 빠졌다(2026-10-09 윈도우 실기기)', () => {
    const list = [S('C:/USERS/Me/.CHAMMO/HQ'), S('c:/users/me/desktop/dev/shop'), S('C:\\Users\\Me\\Desktop\\dev\\api'), S('C:/Users/Me/other')];
    expect(withinRoots(list, ['C:/Users/Me/Desktop/dev', 'C:/Users/Me/.chammo/hq']).map((s) => s.cwd)).toEqual(list.slice(0, 3).map((s) => s.cwd));
  });
  it('맥은 대소문자를 그대로 본다(맥 동작 그대로)', () => {
    expect(withinRoots([S('/Users/me/HQ'), S('/Users/me/hq')], ['/Users/me/hq']).map((s) => s.cwd)).toEqual(['/Users/me/hq']);
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

describe('윈도우 — agents 의 C:\\… cwd 도 HQ·프로젝트로 알아본다(윈도우 5단계 "참모 세션이 없어요")', () => {
  it('cwd 를 C:/… 로 맞춰 HQ 비서와 프로젝트를 가른다', () => {
    const raw = [
      { id: 'a', name: assistant(), cwd: 'C:\\Users\\me\\.chammo\\hq', kind: 'background', status: 'idle', state: 'blocked' },
      { id: 'b', name: 'shop', cwd: 'C:\\Users\\me\\dev\\shop', kind: 'background', status: 'busy' },
    ];
    const s = parseAgents(JSON.stringify(raw), 'C:/Users/me/dev');
    expect(s.map((x) => x.cwd)).toEqual(['C:/Users/me/.chammo/hq', 'C:/Users/me/dev/shop']);
    expect(s[1]!.project).toBe('shop');
    const g = groupByProject(s, 'C:/Users/me/.chammo/hq');
    expect(g.orchestrator?.id).toBe('a');
    expect(withinRoots(s, ['C:/Users/me/dev', 'C:/Users/me/.chammo/hq'])).toHaveLength(2);
  });
});

describe('groupByProject — 윈도우 HQ 가 섞인 구분자·대소문자로 와도 참모를 알아본다(폰 "떠 있는 참모가 없어요", 2026-10-05)', () => {
  const raw = [
    { id: 'a', name: assistant(), cwd: 'C:\\Users\\Me\\.chammo\\hq', kind: 'background', status: 'idle', state: 'working' },
    { id: 'b', name: `${assistant()}-2`, cwd: 'c:\\users\\me\\.chammo\\hq\\', kind: 'background', status: 'busy', state: 'working' },
    { id: 'c', name: 'shop', cwd: 'C:\\Users\\Me\\dev\\shop', kind: 'background', status: 'busy' },
  ];
  const s = parseAgents(JSON.stringify(raw), 'C:\\Users\\Me/dev');
  it.each([
    ['config::expand 모양(섞인 구분자)', 'C:\\Users\\Me/.chammo/hq'],
    ['역슬래시만', 'C:\\Users\\Me\\.chammo\\hq'],
    ['끝 / 붙음', 'C:/Users/Me/.chammo/hq/'],
    ['대소문자 다름', 'c:/users/me/.CHAMMO/hq'],
  ])('%s', (_, hq) => {
    const g = groupByProject(s, hq);
    expect(g.orchestrators.map((x) => x.id)).toEqual(['a', 'b']);
    expect(g.projects.map((p) => p.name)).toEqual(['shop']);
  });
  it('맥 HQ 는 대소문자를 그대로 가린다(지금 동작)', () => {
    const mac = parseAgents(JSON.stringify([{ id: 'm', name: assistant(), cwd: '/Users/me/hq', kind: 'background', status: 'idle' }]), '/Users/me/dev');
    expect(groupByProject(mac, '/Users/me/hq/').orchestrators.map((x) => x.id)).toEqual(['m']);
    expect(groupByProject(mac, '/Users/me/HQ').orchestrators).toEqual([]);
  });
});

describe('classifyWorkspace — 윈도우 경로(대소문자·역슬래시 섞임, 2026-10-01 윈도우 PC)', () => {
  const W = 'C:/Users/me/Desktop/dev';
  it('대소문자가 달라도(윈도우는 같은 폴더) 그 아래 프로젝트·작업공간으로', () => {
    expect(classifyWorkspace('C:/Users/me/desktop/dev/acme-shop', W)).toEqual({ project: 'acme-shop', workspace: null });
    expect(classifyWorkspace('c:/users/me/DESKTOP/dev/acme-shop/.claude/worktrees/fix', W)).toEqual({ project: 'acme-shop', workspace: 'fix' });
  });
  it('devRoot 가 역슬래시로 와도', () => {
    expect(classifyWorkspace('C:/Users/me/Desktop/dev/todo-api/src', 'C:\\Users\\me\\Desktop\\dev')).toEqual({ project: 'todo-api', workspace: null });
  });
  it('추가 폴더도 대소문자 무시', () => {
    expect(classifyWorkspace('c:/work/blog-bot/content', W, ['C:\\Work\\blog-bot'])).toEqual({ project: 'blog-bot', workspace: null });
  });
  it('맥 경로는 그대로 대소문자를 가린다', () => {
    expect(classifyWorkspace('/users/me/dev/acme-shop', '/Users/me/dev')).toEqual({ project: 'acme-shop', workspace: null }); // 밖 → 폴더 이름
  });
});

describe('dev 폴더 자체에서 연 세션 — 프로젝트가 아니라 "프로젝트 밖"(2026-10-01 사용자: dev 가 통째로 프로젝트로 잡혔다)', () => {
  it('classifyWorkspace 가 loose 로 표시한다(맥·윈도우 대소문자 무시)', () => {
    expect(classifyWorkspace(DEV, DEV)).toEqual({ project: 'dev', workspace: null, loose: true });
    expect(classifyWorkspace('c:/users/me/desktop/dev', 'C:\\Users\\me\\Desktop\\dev')).toEqual({ project: 'dev', workspace: null, loose: true });
    expect(classifyWorkspace(`${DEV}/todo-api`, DEV)).toEqual({ project: 'todo-api', workspace: null });
  });
  it('groupByProject 는 loose 세션을 프로젝트에서 빼서 따로 모은다', () => {
    const raw = [
      { id: 'a', name: 'notes-chat', cwd: DEV, kind: 'interactive', status: 'idle' },
      { id: 'b', name: 'image-chat', cwd: `${DEV}/`, kind: 'interactive', status: 'idle' },
      { id: 'c', name: 'todo', cwd: `${DEV}/todo-api`, kind: 'background', status: 'idle' },
    ];
    const g = groupByProject(parseAgents(JSON.stringify(raw), DEV), `${DEV}/honor-orchestrator`);
    expect(g.loose.map((x) => x.id)).toEqual(['a', 'b']);
    expect(g.projects.map((p) => p.name)).toEqual(['todo-api']);
  });
});

describe('별명이 실린 진짜 이름도 참모 — 참모-3 · 별명', () => {
  it('참모 판정·대표·다음 번호는 기본 이름으로', () => {
    expect(isOrchestratorName('참모 · 하니터')).toBe(true);
    expect(isOrchestratorName('참모-3 · 하니터')).toBe(false);
    expect(nextOrchestratorName(['참모', '참모-3 · 업데이트'])).toBe('참모-4');
  });
});

describe('언어를 바꿔도 참모는 참모 — 기본 이름이 참모↔Chammo 로 바뀌어도(2026-10-03 QA 18번: 도우미 칸으로 밀리고 새 참모가 떴다)', () => {
  const hq = `${DEV}/honor-orchestrator`;
  const xs = () => parseAgents(JSON.stringify([
    { id: 'a', cwd: hq, kind: 'background', state: 'working', name: '참모' },
    { id: 'b', cwd: hq, kind: 'background', state: 'working', name: '참모-2 · 둘째' },
    { id: 'h', cwd: hq, kind: 'background', state: 'working', name: 'launch-post' },
  ]), DEV);
  it('영어로 바꿔도 한국어 기본 이름 세션은 참모, 도우미는 도우미', () => {
    setLang('en');
    const g = groupByProject(xs(), hq);
    expect(g.orchestrators.map((s) => s.id)).toEqual(['a', 'b']);
    expect(g.helpers.map((s) => s.id)).toEqual(['h']);
    expect(isOrchestratorName('참모')).toBe(true);
  });
  it('한국어로 바꿔도 영어 기본 이름 세션은 참모', () => {
    setLang('ko');
    expect(isOrchestratorName('Chammo')).toBe(true);
    expect(groupByProject(parseAgents(JSON.stringify([{ id: 'c', cwd: hq, kind: 'background', state: 'working', name: 'Chammo-2 · Dev' }]), DEV), hq).helpers).toEqual([]);
  });
});

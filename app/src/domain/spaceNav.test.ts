import { describe, expect, it } from 'vitest';
import { addSpawned, focusPick, focusTab, followChat, harnitorPick, heldBy, reviewPick, toolsPick, holderMap, newShows, orphanSends, showOwner, shownFiles, transcriptTargets } from './spaceNav';
import type { TaskEvent } from './tasks';

const T = Date.parse('2026-09-30T04:00:00Z');
const ev = (o: Partial<TaskEvent> & { type: TaskEvent['type']; task: string }): TaskEvent => ({ ts: '2026-09-30T03:00:00Z', ...o });

describe('heldBy — 이 참모가 잡고 있는 세션(채팅 뷰 스페이스 왼쪽 목록)', () => {
  it('마지막으로 일을 보낸 참모가 잡는다 — 끝으로 닫아도 유지(답 받자마자 닫아서 표시가 사라졌다, 2026-09-30 사용자)', () => {
    const evs = [
      ev({ type: 'send', task: 'a', target: 'demo-lab', from: 'orch-a', ts: '2026-09-30T01:00:00Z' }),
      ev({ type: 'send', task: 'b', target: 'oms', from: 'orch-b' }),
      ev({ type: 'send', task: 'c', target: 'shop-app', from: 'orch-a', ts: '2026-09-30T02:00:00Z' }),
      ev({ type: 'done', task: 'c' }),
    ];
    expect(heldBy(evs, 'orch-a', T)).toEqual(['shop-app', 'demo-lab']);
    expect(heldBy(evs, 'orch-b', T)).toEqual(['oms']);
  });
  it('다른 참모가 나중에 보내면 그 참모로 넘어간다 — "oms" 와 "oms [id]" 는 같은 세션', () => {
    const evs = [
      ev({ type: 'send', task: 'a', target: 'oms [ee5566]', from: 'orch-a', ts: '2026-09-30T01:00:00Z' }),
      ev({ type: 'send', task: 'b', target: 'oms', from: 'orch-b', ts: '2026-09-30T02:00:00Z' }),
    ];
    expect(heldBy(evs, 'orch-a', T)).toEqual([]);
    expect(heldBy(evs, 'orch-b', T)).toEqual(['oms']);
  });
  it('누가 시켰는지 안 남은 옛 기록은 어느 참모에도 안 붙는다 — 참모-2 대시보드에 참모1 일이 떴다(2026-09-30 사용자)', () => {
    const evs = [ev({ type: 'send', task: 'a', target: 'notes-app' })];
    expect(heldBy(evs, 'orch-a', T)).toEqual([]);
  });
  it('사용자가 주인을 붙이면(own) 그 참모 것', () => {
    const evs = [ev({ type: 'send', task: 'a', target: 'notes-app' }), ev({ type: 'own', task: 'a', from: 'orch-a' })];
    expect(heldBy(evs, 'orch-a', T)).toEqual(['notes-app']);
    expect(heldBy(evs, 'other', T)).toEqual([]);
  });
  it('사흘 넘게 지난 일은 풀린다, 같은 대상은 한 번만(최근 순)', () => {
    const evs = [
      ev({ type: 'send', task: 'old', target: 'project-b', from: 'x', ts: '2026-09-26T00:00:00Z' }),
      ev({ type: 'send', task: 'mid', target: 'video-app', from: 'x', ts: '2026-09-28T00:00:00Z' }),
      ev({ type: 'send', task: 'a', target: 'oms', from: 'x', ts: '2026-09-30T01:00:00Z' }),
      ev({ type: 'send', task: 'b', target: 'oms', from: 'x', ts: '2026-09-30T02:00:00Z' }),
      ev({ type: 'send', task: 'c', target: 'shop-app', from: 'x', ts: '2026-09-30T02:30:00Z' }),
    ];
    expect(heldBy(evs, 'x', T)).toEqual(['shop-app', 'oms', 'video-app']);
  });
});

describe('shownFiles — 그 세션이 보여 준 파일(scripts/show 기록)', () => {
  it('지워진 파일(gone — 앱이 기록을 읽을 때 단다)은 목록에서 뺀다', () => {
    const l = [JSON.stringify({ ts: '1', path: '/d/a.md', from: 's' }), JSON.stringify({ ts: '2', path: '/d/x.png', from: 's', gone: true })].join('\n');
    expect(shownFiles(l, 's').map((f) => f.path)).toEqual(['/d/a.md']);
  });
  it('짚은 곳(at)도 같이 — 가장 최근 줄 것', () => {
    const l = [JSON.stringify({ ts: '1', path: '/d/a.md', from: 's', at: { line: 3 } }), JSON.stringify({ ts: '2', path: '/d/a.md', from: 's', at: { find: '제목' } })].join('\n');
    expect(shownFiles(l, 's')).toEqual([{ path: '/d/a.md', ts: '2', at: { find: '제목' } }]);
  });
  const log = [
    JSON.stringify({ ts: '1', path: '/d/demo-lab/index.html', from: 'sess-x', cwd: '/d/demo-lab' }),
    JSON.stringify({ ts: '2', path: '/d/other/a.md', from: 'zzz' }),
    JSON.stringify({ ts: '3', path: '/d/demo-lab/docs/starter.md', from: 'sess-x' }),
    '{깨진 줄',
    JSON.stringify({ ts: '4', path: '/d/demo-lab/index.html', from: 'sess-x' }),
  ].join('\n');
  it('그 세션 것만 최근 순, 같은 파일은 한 번', () => {
    expect(shownFiles(log, 'sess-x')).toEqual([
      { path: '/d/demo-lab/index.html', ts: '4' },
      { path: '/d/demo-lab/docs/starter.md', ts: '3' },
    ]);
  });
});

describe('holderMap — 프로젝트 세션마다 잡고 있는 참모들(메뉴 색 점)', () => {
  const T2 = Date.parse('2026-09-30T04:00:00Z');
  const resolve = (t: string) => ({ 'project-b-inside': 's-project-b', oms: 's-oms', 'shop-app': 's-shop' } as Record<string, string>)[t];
  it('참모마다 잡은 세션 → 세션마다 잡은 참모', () => {
    const evs = [
      ev({ type: 'send', task: 'a', target: 'oms', from: 'b1' }),
      ev({ type: 'send', task: 'b', target: 'project-b-inside', from: 'b1', ts: '2026-09-30T01:00:00Z' }),
      ev({ type: 'send', task: 'c', target: 'project-b-inside', from: 'b2', ts: '2026-09-30T02:00:00Z' }),
      ev({ type: 'send', task: 'd', target: 'shop-app', from: 'b2' }),
    ];
    const m = holderMap(evs, ['b1', 'b2'], resolve, T2);
    expect(m.get('s-oms')).toEqual(['b1']);
    expect(m.get('s-project-b')).toEqual(['b2']); // 나중에 보낸 참모가 잡는다
    expect(m.get('s-shop')).toEqual(['b2']);
  });
  it('못 찾는 대상(꺼진 세션)은 빼고, 누가 시켰는지 안 남은 옛 기록은 아무 참모에도', () => {
    const evs = [ev({ type: 'send', task: 'a', target: 'gone', from: 'b1' }), ev({ type: 'send', task: 'b', target: 'oms' })];
    expect([...holderMap(evs, ['b1', 'b2'], resolve, T2).keys()]).toEqual([]);
  });
});

describe('newShows — 채팅 뷰에서 모달로 띄울 새 파일(scripts/show 기록)', () => {
  const log = [
    JSON.stringify({ ts: '2026-09-30T04:00:00+00:00', path: '/a.html', from: 'b2' }),
    JSON.stringify({ ts: '2026-09-30T04:05:00+00:00', path: '/b.md', from: 'b1' }),
    JSON.stringify({ ts: '2026-09-30T04:06:00+00:00', path: '/c.png', from: 's1' }),
  ].join('\n');
  it('지켜보는 세션(이 참모·맡긴 세션)이 since 뒤에 띄운 것만, 오래된 순', () => {
    expect(newShows(log, ['b1', 's1'], Date.parse('2026-09-30T04:01:00Z')).map((f) => f.path)).toEqual(['/b.md', '/c.png']);
    expect(newShows(log, ['b1'], Date.parse('2026-09-30T04:05:00Z'))).toEqual([]);
  });
});

describe('followChat — 메뉴에서 보고 있는 참모(채팅 탭을 바꾸면 따라가고, 메뉴에서 고른 건 채팅 탭을 안 바꾼다 — 2026-09-30 사용자)', () => {
  it('채팅 탭이 바뀌면 그 참모로', () => {
    expect(followChat({ view: 'b2', chat: 'b1' }, 'b3')).toEqual({ view: 'b3', chat: 'b3' });
  });
  it('채팅 탭 그대로면 메뉴에서 고른 참모 유지', () => {
    expect(followChat({ view: 'b2', chat: 'b1' }, 'b1')).toEqual({ view: 'b2', chat: 'b1' });
  });
  it('처음엔 채팅 탭 참모', () => {
    expect(followChat({ view: undefined, chat: undefined }, 'b1')).toEqual({ view: 'b1', chat: 'b1' });
  });
});

describe('newShows(ids = null) — 채팅 뷰에선 어느 세션이 띄운 것이든(리더를 안 쓰니까, 2026-09-30 사용자)', () => {
  it('누가 띄웠는지 없어도·다른 참모여도 since 뒤면 다', () => {
    const log = [JSON.stringify({ ts: '2026-09-30T04:05:00+00:00', path: '/a.md', from: 'other' }), JSON.stringify({ ts: '2026-09-30T04:06:00+00:00', path: '/b.png' })].join('\n');
    expect(newShows(log, null, Date.parse('2026-09-30T04:00:00Z')).map((f) => f.path)).toEqual(['/a.md', '/b.png']);
  });
  it('짚은 곳(at)도 같이 — 줄·글·페이지', () => {
    const log = JSON.stringify({ ts: '2026-09-30T04:05:00+00:00', path: '/a.md', at: { line: 264, find: '네이버' } });
    expect(newShows(log, null, 0)[0]!.at).toEqual({ line: 264, find: '네이버' });
  });
});

describe('orphanSends — 누가 시켰는지 모르는 열린 일(대시보드 힌트, 사용자가 붙이거나 정리)', () => {
  it('하루 안·안 닫힘·주인 없음만, 최근 순', () => {
    const evs = [
      ev({ type: 'send', task: 'a', target: 'oms', title: 'OMS 정리', ts: '2026-09-30T01:00:00Z' }),
      ev({ type: 'send', task: 'b', target: 'shop-app', ts: '2026-09-30T02:00:00Z' }),
      ev({ type: 'done', task: 'b' }),
      ev({ type: 'send', task: 'c', target: 'project-b', from: 'b1' }),
      ev({ type: 'send', task: 'd', target: 'project-k', ts: '2026-09-30T03:00:00Z' }),
      ev({ type: 'own', task: 'd', from: 'b2' }),
      ev({ type: 'send', task: 'e', target: 'old', ts: '2026-09-28T00:00:00Z' }),
    ];
    expect(orphanSends(evs, T).map((x) => [x.task, x.target, x.title])).toEqual([['a', 'oms', 'OMS 정리']]);
  });
});

describe('transcriptTargets — 참모 대화 기록에서 띄우거나 말 건 세션(작업 기록 없이도)', () => {
  const line = (name: string, input: Record<string, unknown>) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
  it('claude --bg … -n 이름 과 SendMessage 받는 이(뒤 [ref] 는 뗀다) — 작업 기록 없이 띄운 세션도 잡는다', () => {
    const tail = [
      line('Bash', { command: 'cd ~/dev/acme-shop && claude --bg --dangerously-skip-permissions -n report-fix "x"' }),
      line('Bash', { command: "claude --bg -n 'font-fix' --model opus \"y\"" }),
      line('SendMessage', { to: 'worker [abc123]', message: 'x' }),
      line('SendMessage', { to: 'notes', message: 'y' }),
    ].join('\n');
    expect(transcriptTargets(tail)).toEqual(['report-fix', 'font-fix', 'worker', 'notes']);
  });
  it('변수 이름($repo)·main(자기 부모)·깨진 줄·다른 도구는 뺀다, 같은 이름은 한 번', () => {
    const tail = [
      line('Bash', { command: 'claude --bg -n "starter-$repo" "x"' }),
      line('SendMessage', { to: 'main', message: 'x' }),
      '{깨짐',
      line('Read', { file_path: '/x' }),
      line('SendMessage', { to: 'worker', message: '1' }),
      line('SendMessage', { to: 'worker [abc123]', message: '2' }),
    ].join('\n');
    expect(transcriptTargets(tail)).toEqual(['worker']);
  });
});

describe('transcriptTargets — 글 안에 든 claude --bg 는 안 친다(2026-10-01 오탐: 테스트 코드 예시 문장으로 내가 project-a 를 잡은 걸로 보였다)', () => {
  const bash = (command: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  it('heredoc 본문·따옴표 안·grep 검색어는 빼고, 실제로 실행한 줄만', () => {
    const tail = [
      bash("cat >> x.test.ts <<'EOF'\n  line('Bash', { command: 'cd ~/dev/acme-shop && claude --bg -n report-fix \"x\"' }),\nEOF"),
      bash("python3 -c \"print('claude --bg -n ghost')\""),
      bash("grep -n 'claude --bg -n fake' file.ts"),
      bash('echo "claude --bg -n echoed"'),
      bash('cd /h/dev/acme && claude --bg --dangerously-skip-permissions -n real-one "지시"'),
      bash('X=1; claude --bg -n "second one" "y"'),
    ].join('\n');
    expect(transcriptTargets(tail)).toEqual(['real-one', 'second one']);
  });
});

describe('showOwner — 띄운 문서를 어느 참모 화면에 둘까(2026-10-01 사용자: 참모1 이 띄운 게 보고 있던 참모2 화면에 떴다)', () => {
  const holders = new Map([['w1', ['o1']], ['w2', ['o2', 'o1']]]);
  it('참모가 띄웠으면 그 참모', () => {
    expect(showOwner('o1', ['o1', 'o2'], holders)).toBe('o1');
  });
  it('하위 세션이 띄웠으면 그 세션을 잡은 참모(여럿이면 첫째)', () => {
    expect(showOwner('w1', ['o1', 'o2'], holders)).toBe('o1');
    expect(showOwner('w2', ['o1', 'o2'], holders)).toBe('o2');
  });
  it('모르는 세션·사람(me)·빈 값이면 null — 지금 보는 화면에', () => {
    expect(showOwner('stranger', ['o1'], holders)).toBeNull();
    expect(showOwner('me', ['o1'], holders)).toBeNull();
    expect(showOwner('', ['o1'], holders)).toBeNull();
  });
});

describe('harnitorPick — 하니터도 탭마다 기억되는 화면 하나(h:), 큐레이션처럼', () => {
  // 2026-10-02 사용자: 하니터가 앱 전체에 고정이라 다른 탭으로 가도 남아 있고, 다른 참모가 띄운 게 가려질 것 같았다
  it('열면 보던 화면을 기억하고 h: 로', () => {
    expect(harnitorPick('o:a', 'open', '', 'o:a')).toEqual({ pick: 'h:', before: 'o:a' });
    expect(harnitorPick('d:/x.md', 'toggle', '', 'o:a')).toEqual({ pick: 'h:', before: 'd:/x.md' });
  });
  it('닫으면 열기 전 화면으로', () => {
    expect(harnitorPick('h:', 'close', 'd:/x.md', 'o:a')).toEqual({ pick: 'd:/x.md', before: '' });
    expect(harnitorPick('h:', 'toggle', 's:1', 'o:a')).toEqual({ pick: 's:1', before: '' });
  });
  it('기억이 없으면 그 참모 대시보드로', () => {
    expect(harnitorPick('h:', 'close', '', 'o:a').pick).toBe('o:a');
  });
  it('이미 열려 있으면 열기는 그대로, 안 열려 있으면 닫기는 그대로', () => {
    expect(harnitorPick('h:', 'open', 'o:a', 'o:a')).toEqual({ pick: 'h:', before: 'o:a' });
    expect(harnitorPick('o:a', 'close', '', 'o:a')).toEqual({ pick: 'o:a', before: '' });
  });
});

describe('toolsPick — 위 막대 도구 아이콘(2026-10-05 사용자): 하니터처럼 탭마다 열고 닫기, 프로젝트 도구(t:<폴더>)도 열린 걸로', () => {
  it('열면 참모 HQ 기준 도구(t:)로, 보던 화면은 기억', () => {
    expect(toolsPick('o:a', 'toggle', '', 'o:a')).toEqual({ pick: 't:', before: 'o:a' });
    expect(toolsPick('d:/x.md', 'open', '', 'o:a')).toEqual({ pick: 't:', before: 'd:/x.md' });
  });
  it('프로젝트 대시보드에서 연 도구(t:/d/project-b)도 열린 것 — 다시 누르면 닫고 그 전 화면으로', () => {
    expect(toolsPick('t:/d/project-b', 'toggle', 'p:/d/project-b', 'o:a')).toEqual({ pick: 'p:/d/project-b', before: '' });
    expect(toolsPick('t:/d/project-b', 'open', 'p:/d/project-b', 'o:a')).toEqual({ pick: 't:/d/project-b', before: 'p:/d/project-b' });
  });
  it('기억이 없으면 그 참모 대시보드로, 안 열려 있으면 닫기는 그대로', () => {
    expect(toolsPick('t:', 'close', '', 'o:a').pick).toBe('o:a');
    expect(toolsPick('h:', 'close', '', 'o:a')).toEqual({ pick: 'h:', before: '' });
  });
});

describe('reviewPick — 위 막대 리뷰 아이콘(2026-10-06 사용자): 도구처럼 탭마다 열고 닫기, PR 하나 고른 것(rv:<키>)도 열린 걸로', () => {
  it('열면 리뷰 첫 화면(rv:)으로, 보던 화면은 기억', () => {
    expect(reviewPick('o:a', 'toggle', '', 'o:a')).toEqual({ pick: 'rv:', before: 'o:a' });
    expect(reviewPick('p:/d/project-b', 'open', '', 'o:a')).toEqual({ pick: 'rv:', before: 'p:/d/project-b' });
  });
  it('PR 하나를 보고 있어도(rv:project-b#12) 열린 것 — 다시 누르면 닫고 그 전 화면으로, 열기는 그대로', () => {
    expect(reviewPick('rv:project-b#12', 'toggle', 'd:/x.md', 'o:a')).toEqual({ pick: 'd:/x.md', before: '' });
    expect(reviewPick('rv:project-b#12', 'open', 'd:/x.md', 'o:a')).toEqual({ pick: 'rv:project-b#12', before: 'd:/x.md' });
  });
  it('기억이 없으면 그 참모 대시보드로', () => {
    expect(reviewPick('rv:', 'close', '', 'o:a').pick).toBe('o:a');
  });
});

describe('focusPick — 채팅 뷰에서 focus 는 스페이스 대시보드로(터미널로 넘어가지 않는다)', () => {
  const sessions = [{ id: 's1', cwd: '/d/project-b', project: 'project-b' }, { id: 'o1', cwd: '/hq', project: '' }];
  const groups = [{ name: 'project-b', root: '/d/project-b' }];
  const idle = [{ name: 'project-x-app', root: '/d/project-x-app' }];
  it('세션이면 그 프로젝트 대시보드', () => expect(focusPick({ session: 's1' }, sessions, groups, idle, ['o1'])).toBe('p:/d/project-b'));
  it('참모면 그 참모 대시보드', () => expect(focusPick({ session: 'o1' }, sessions, groups, idle, ['o1'])).toBe('o:o1'));
  it('프로젝트 이름이면 그 프로젝트 — 세션이 안 떠 있어도', () => {
    expect(focusPick({ project: 'project-b' }, sessions, groups, idle, [])).toBe('p:/d/project-b');
    expect(focusPick({ project: 'project-x-app' }, sessions, groups, idle, [])).toBe('p:/d/project-x-app');
  });
  it('모르면 null', () => expect(focusPick({ project: 'nope' }, sessions, groups, idle, [])).toBeNull());
});

describe('focusTab — scripts/app focus <참모> 는 채팅 탭도 그 참모로(fix/space-jump ①, 스페이스만 옮기면 ViewSeg 없는 어긋난 모양)', () => {
  it('참모 대시보드면 그 참모 탭', () => expect(focusTab('o:o1')).toBe('o1'));
  it('프로젝트·세션 대시보드면 탭은 그대로', () => {
    expect(focusTab('p:/d/project-b')).toBeUndefined();
    expect(focusTab('s:s1')).toBeUndefined();
  });
});

describe('addSpawned — 대화 기록으로 잡은 세션은 작업 기록 주인이 없을 때만(handoff 가 이긴다, 2026-10-02)', () => {
  const resolve = (n: string) => ({ 'project-b-platform': 's1', helper: 's2' } as Record<string, string>)[n];
  it('작업 기록에 주인이 있으면 처음 띄운 참모 기록으로 덧붙이지 않는다', () => {
    const m = new Map([['s1', ['o5']]]); // handoff 로 참모-5 가 주인
    const out = addSpawned(m, new Map([['o4', new Set(['project-b-platform'])]]), resolve, ['o4', 'o5']);
    expect(out.get('s1')).toEqual(['o5']);
  });
  it('작업 기록에 없는 세션(task send 없이 띄운 도우미)은 대화 기록으로 붙인다', () => {
    const out = addSpawned(new Map(), new Map([['o4', new Set(['helper'])]]), resolve, ['o4']);
    expect(out.get('s2')).toEqual(['o4']);
  });
  it('참모 자신이나 없는 세션은 빼고, 원본 지도는 안 건드린다', () => {
    const m = new Map<string, string[]>();
    const out = addSpawned(m, new Map([['o4', new Set(['o5name', 'gone'])]]), (n) => (n === 'o5name' ? 'o5' : undefined), ['o4', 'o5']);
    expect(out.size).toBe(0);
    expect(m.size).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { followChat, heldBy, holderMap, newShows, orphanSends, shownFiles, transcriptTargets } from './spaceNav';
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

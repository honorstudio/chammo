// 입력칸 위 줄 '#file1 "경로"' 가 보낸 뒤에도 남던 것(2026-11-06 사용자 now.png, 11-05 before-1105.png) —
// 0.4초 터미널 읽기 타이머가 [screen] 에 걸려 있었는데 SessionGrid 는 screen 을 렌더마다 새 함수로 넘긴다.
// 일하는 중 부모가 0.4초보다 자주 다시 그려지면 타이머가 걸렸다 지워지기만 하고 한 번도 안 돌아, 위 줄 글이 보내기 직전 값
// (붙인 경로뿐 — 글은 채팅 입력칸에 있었다)에 얼어붙었다. 첨부 줄은 보낼 때 비워져 칩 없이 경로 글만 보였다.
// 진짜 App 하네스(.harness, 부모를 0.15초마다 다시 그림)에서 끌기·그림+파일·#보관함·파일 고르기·붙여넣기·이름표 고침 여섯 길 다 재현
import { describe, expect, it } from 'vitest';
import chat from './ChatView.tsx?raw';
import grid from '../SessionGrid.tsx?raw';
import desk from '../space/DeskBubble.tsx?raw';

/** 0.4초 읽기 타이머를 거는 효과 덩어리 — setInterval(…, 400) 부터 그 효과의 의존 배열까지 */
const readEffect = () => {
  const at = chat.indexOf('const read = !s ?');
  expect(at).toBeGreaterThan(0);
  const start = chat.lastIndexOf('useEffect(', at);
  const end = chat.indexOf('}, 400);', at);
  const deps = chat.slice(end + 8, end + 300).match(/\}, (\[[^\]]*\])\);/);
  return { body: chat.slice(start, end), deps: deps?.[1] ?? '' };
};

describe('터미널 입력칸 읽기 타이머 — 부모가 자주 다시 그려도 돈다', () => {
  it('부르는 쪽은 screen 을 렌더마다 새 함수로 넘긴다(이 전제가 바뀌면 이 시험도 다시 본다)', () => {
    expect(grid).toContain('screen={(back) => panes.current.get(id)?.screen(back)}');
    expect(desk).toContain("screen={state === 'blocked' ? () => scr.current : undefined}");
  });
  it('타이머는 screen 함수가 바뀔 때마다 다시 걸리지 않는다 — 있나 없나만 본다', () => {
    const { deps } = readEffect();
    expect(deps).not.toBe('[screen]');
    expect(deps).toBe('[hasScreen]');
  });
  it('타이머 안에서는 지금 screen 을 ref 로 부른다 — 처음 걸 때 함수에 묶이지 않게', () => {
    const { body } = readEffect();
    expect(chat).toContain('screenRef.current = screen;');
    expect(body).toContain('screenRef.current?.(');
    expect(body).not.toMatch(/[^.]\bscreen\(/);
  });
});

describe('가만히 있을 땐 화면을 덜 읽는다(11-06 perf-bench 가만히 앱 CPU 4.16 > 3)', () => {
  it('타이머는 0.4초 그대로, 첫 줄에서 읽을 차례인지(termReadDue) 보고 아니면 바로 돌아간다', () => {
    const { body } = readEffect();
    const at = body.indexOf('termReadDue(');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(body.indexOf('screenRef.current?.('));
    expect(body).toContain('lastRead.current = now;');
  });
  it('쓰기·붙이기·보내기·답 상태가 바뀌면 깨운다 — 그 뒤 10초는 매번', () => {
    expect(chat).toMatch(/useEffect\(\(\) => \{ stirred\.current = Date\.now\(\); \}, \[draft, attached, pending\.length, pollMs\]\);/);
  });
  it('일 표시(첨부·위 줄 글·선택 창·붙이는 중·요약 중)가 있으면 바쁨', () => {
    expect(chat).toMatch(/busyRef\.current = attached\.length > 0 \|\| !!termText \|\| !!dialog \|\| pasting \|\| compacting;/);
  });
});

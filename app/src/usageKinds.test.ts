// 익명 사용 통계 — 화면이 세는 이름(data/tauri.ts UsageKind)과 Rust usage_counts 의 정해 둔 이름이 같아야 한다.
// 목록 밖 이름은 Rust 가 버려서, 어긋나면 조용히 0 으로 남는다
import { describe, expect, it } from 'vitest';
import rust from '../src-tauri/src/usage_counts.rs?raw';
import { ALL_ON } from './domain/config';

const list = (name: string) => {
  const m = rust.match(new RegExp(`pub const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\]`));
  return (m?.[1] ?? '').split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean);
};

describe('익명 사용 통계 이름', () => {
  it('화면이 세는 기능(사무실·메신저·Craft)은 Rust 쓰임 목록에, 화면 오류(webview)는 오류 종류 목록에 있다', () => {
    expect(list('USE_KEYS')).toEqual(expect.arrayContaining(['office', 'messenger', 'craft']));
    expect(list('CRASH_KINDS')).toContain('webview');
  });

  // craftBasics(기본 참모 앱 미리 받기)도 뺀다 — 보내는 칸을 늘리면 처리방침 항목이 바뀐다
  // bubble(떠 있는 참모 배지, 10-28)도 뺀다 — 같은 이유
  it('켜 둔 기능 목록은 설정 스위치 전부에서 익명 사용 통계·기본 앱 미리 받기·떠 있는 배지·애니메이션만 뺀 것', () => {
    const switches = Object.keys(ALL_ON).filter((k) => k !== 'usagePing' && k !== 'craftBasics' && k !== 'bubble' && k !== 'bubbleDesk' && k !== 'animation');
    expect(list('ON_KEYS')).toEqual(switches);
  });
});

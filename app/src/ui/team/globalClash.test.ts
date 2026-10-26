import { describe, expect, it } from 'vitest';
import styles from '../styles.css?raw';

// 2026-10-26 사용자 캡처: 팀챗 0개일 때 '아직 팀챗이 없어요'(.tmx-none.sm)가 한 글자씩 세로로 쌓여 'DM' 머리에 겹쳤다 —
// .sm 은 styles.css 전역 상태 점(inline-flex, 폭·높이 12px)이라 본 앱·메신저 창(styles.css 를 부름)에서만 먹고 폰은 멀쩡했다.
// 팀 화면 클래스는 tmx-·tmc- 이름으로 — 전역에 '홀로' 모양이 있는 짧은 이름(.sm·.side 류)을 같이 붙이지 않는다
const team = import.meta.glob(['./*.tsx', '../mobile/PhoneTeam.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** 일부러 쓰는 전역 모양 — 앱 공통 버튼 */
const SHARED = new Set(['btn']);

/** styles.css 에서 선택자 맨 앞 칸이 클래스 하나뿐인 것(.sm {…}·.sm svg {…}) — 어디에 붙여도 그 모양이 먹는다 */
function bareGlobals(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of (m[1] ?? '').split(',')) {
      const first = /^\s*\.([\w-]+)(?=[\s:>+~[]|$)/.exec(sel);
      if (first) out.add(first[1]!);
    }
  }
  return out;
}

/** className="…"·className={`…`} 의 낱말(${…} 은 빼고) */
function classTokens(src: string): string[] {
  return [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
    .flatMap((m) => (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' ').split(/\s+/))
    .filter(Boolean);
}

describe('팀 화면 클래스 — styles.css 전역 클래스와 안 겹친다', () => {
  const globals = bareGlobals(styles);

  it('전역 목록을 제대로 읽는다(.sm 상태 점·.btn 버튼)', () => {
    expect(globals.has('sm')).toBe(true);
    expect(globals.has('btn')).toBe(true);
    expect(globals.has('pri')).toBe(false); // .btn.pri 처럼 붙어서만 모양이 있는 건 안 걸린다
  });

  it('찾는 법이 옛 버그를 잡는다', () => {
    expect(classTokens('<div className="tmx-none sm">').filter((t) => globals.has(t) && !SHARED.has(t))).toEqual(['sm']);
  });

  it.each(Object.keys(team).filter((f) => !f.includes('.test.')))('%s', (file) => {
    const clash = classTokens(team[file]!).filter((t) => globals.has(t) && !SHARED.has(t));
    expect(clash).toEqual([]);
  });

  it('빈 팀챗 안내는 팀 전용 작은 글 클래스(.tmx-none.tmx-sm)', () => {
    expect(team['./TeamList.tsx']).toContain('className="tmx-none tmx-sm"');
    expect(team['./RoomCreate.tsx']).toContain('className="tmx-none tmx-sm"');
  });
});

// 참모가 앱을 대신 조작한다 — HQ scripts/app 이 <데이터 폴더>/app.jsonl 에 {ts, action, arg} 를 쓰면
// Rust(appctl.rs)가 새 줄을 window.__appctl 로 넘기고, 여기서 "앱이 할 일"로 바꾼다. 실제 적용은 App.tsx
import type { Features } from './config';
import type { Session } from './session';
import type { Shortcut } from './shortcuts';
import { findTarget } from './inbox';

export const OPEN = ['settings', 'tour', 'office', 'review', 'all', 'replay', 'load', 'reader', 'tasks', 'inbox', 'home', 'harnitor', 'tools'] as const;
export type OpenWhat = (typeof OPEN)[number];
export const CLOSE = ['settings', 'office', 'reader', 'tasks', 'inbox', 'harnitor', 'tools'] as const;
export type CloseWhat = (typeof CLOSE)[number];
const FEATURES: (keyof Features)[] = ['office', 'tama', 'gacha', 'review', 'voice', 'autoRevive', 'computerUse'];

export type AppIntent =
  | { kind: 'voice'; on: boolean }
  | { kind: 'feature'; name: keyof Features; on: boolean }
  | { kind: 'open'; what: OpenWhat }
  | { kind: 'close'; what: CloseWhat }
  | { kind: 'focus'; target: string; terminal?: true }
  | { kind: 'pet'; show: boolean }
  | { kind: 'reload' }
  /** 폰(폰 서버 /api/rename)이 바꾼 참모 별명 — 앱 별명에 넣으면 쉬는 때 /rename 이 따라간다 */
  | { kind: 'label'; id: string; nick: string };

const onOff = (v: string | undefined) => (v === 'on' ? true : v === 'off' ? false : null);

/** 한 줄 → 할 일. 모르는 동작·인자는 null(무시) — 스크립트가 먼저 거르지만 손으로 쓴 줄도 올 수 있다 */
export function intentOf(line: unknown): AppIntent | null {
  if (!line || typeof line !== 'object') return null;
  const { action, arg } = line as { action?: unknown; arg?: unknown };
  const a = typeof arg === 'string' ? arg.trim() : '';
  if (action === 'orch-label') {
    const o = arg as { id?: unknown; nick?: unknown } | null;
    return o && typeof o === 'object' && typeof o.id === 'string' && typeof o.nick === 'string' ? { kind: 'label', id: o.id, nick: o.nick } : null;
  }
  if (action === 'voice') {
    const on = onOff(a);
    return on === null ? null : { kind: 'voice', on };
  }
  if (action === 'feature') {
    const [name, v] = a.split(/\s+/);
    const on = onOff(v);
    return FEATURES.includes(name as keyof Features) && on !== null ? { kind: 'feature', name: name as keyof Features, on } : null;
  }
  if (action === 'open') return (OPEN as readonly string[]).includes(a) ? { kind: 'open', what: a as OpenWhat } : null;
  if (action === 'close') return (CLOSE as readonly string[]).includes(a) ? { kind: 'close', what: a as CloseWhat } : null;
  // 터미널(CLI)은 --terminal 로 명시할 때만 — 채팅 뷰에서 "띄워 줘"가 세션 CLI 로 넘어갔다(2026-10-02 사용자)
  if (action === 'focus') {
    const m = a.match(/^--terminal\s+(.+)$/);
    if (m) return { kind: 'focus', target: m[1]!.trim(), terminal: true };
    return a ? { kind: 'focus', target: a } : null;
  }
  if (action === 'config') return a === 'reload' ? { kind: 'reload' } : null;
  if (action === 'pet') return a === 'show' || a === 'hide' ? { kind: 'pet', show: a === 'show' } : null;
  return null;
}

/** 여러 줄(JSONL) → 할 일들. 깨진 줄은 건너뛴다 */
export const parseAppLog = (text: string): AppIntent[] =>
  text.split('\n').flatMap((l) => {
    try {
      const i = intentOf(JSON.parse(l));
      return i ? [i] : [];
    } catch {
      return [];
    }
  });

/** 열기 중 단축키(⌘,·⌘/·⌘1~4)와 같은 동작 — 꺼 둔 기능 막기(allowed)도 같이 탄다. 토글인 것은 null(따로 켠다) */
export function openShortcut(what: OpenWhat): Shortcut | null {
  switch (what) {
    case 'settings': return { type: 'settings' };
    case 'tour': return { type: 'tour' };
    case 'office': return { type: 'goto', to: 'office' };
    case 'review': return { type: 'goto', to: 'review' };
    case 'all': return { type: 'goto', to: 'all' };
    case 'home': return { type: 'goto', to: 'orchestrator' };
    default: return null;
  }
}

/** 설정의 기능 하나만 바꾼 새 설정(원본은 그대로) — 설정 화면 저장과 같은 모양으로 write_config 에 넘긴다 */
export const withFeature = <C extends { features: Features }>(c: C, name: keyof Features, on: boolean): C => ({ ...c, features: { ...c.features, [name]: on } });

/** "그 세션으로 가기" — 세션 id·이름·대화 id 가 먼저, 아니면 프로젝트 이름(도는 세션이 없어도 화면은 있다) */
export function focusPlan(target: string, sessions: Session[], projects: string[]): { session: string } | { project: string } | null {
  const s = findTarget(sessions, target);
  if (s) return { session: s.id };
  if (projects.includes(target) || sessions.some((x) => x.project === target)) return { project: target };
  return null;
}

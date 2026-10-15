// 참모 상태 = 프사 옆 점(시안 phone-dash O1, 2026-10-11) — 글자 배지(일함·물음·쉼) 대신. 묻는 중이 먼저
import type { Session } from './session';

export function orchDot(state: Session['state'], asking: boolean): { cls: 'st-wait' | 'st-work' | 'st-done'; label: string } {
  if (asking || state === 'blocked') return { cls: 'st-wait', label: '물음' };
  if (state === 'working') return { cls: 'st-work', label: '일하는 중' };
  return { cls: 'st-done', label: '쉼' };
}

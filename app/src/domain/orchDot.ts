// 참모 상태 = 프사 옆 점(시안 phone-dash O1, 2026-10-11) — 글자 배지(일함·물음·쉼) 대신. 묻는 중이 먼저
// 판단은 세션판과 같은 activityStatus(대화 꼬리) — 날 state 만 보면 감시를 띄운 참모가 '일함'이었다(bug-hunt L10). 갈래는 데스크톱 statusTone 과 같다
import { statusTone, statusWord, type ActivityStatus } from './status';

export function orchDot(st: ActivityStatus, asking: boolean): { cls: 'st-wait' | 'st-work' | 'st-done'; label: string } {
  if (asking || st === 'asks' || st === 'blocked') return { cls: 'st-wait', label: '물음' };
  const tone = statusTone(st);
  return { cls: tone === 'run' ? 'st-work' : tone === 'ask' ? 'st-wait' : 'st-done', label: statusWord(st) };
}

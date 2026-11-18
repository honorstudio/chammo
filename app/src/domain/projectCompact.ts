// 프로젝트 세션 자동 정리(2026-11-17 사용자 "참모들 말고 그냥 프로젝트들은?") — 참모 정리(domain/chiefCompact)를 프로젝트 세션에 넓힌 것.
// 다른 점: 50% 부터(하던 일 세부 맥락이 더 중요), 인계는 그 프로젝트 docs/starter.md '지금 하던 일' 칸(커밋 없이 파일만),
// 결제·운영 직전에 맡긴 참모 답을 기다리며 쉬는 세션은 건드리지 않음, 끝나면 맡긴 참모에게 [앱] 한 줄(건 조건을 다시 보내게). 흐름은 ui/useChiefCompact
import type { Activity } from './activity';
import { turnStart } from './forwardQuestion';

/** 이 % 부터 정리 후보 — 참모(40)보다 높게 */
export const PROJECT_MIN = 50;

/** 돈·운영이 걸린 낱말 — 세션이 참모에게 이걸 묻고 쉬는 중이면 정리하지 않는다 */
const GATE = /결제|환불|과금|운영|프로덕션|production|배포|마이그|OTA|eas update|발송|실사용자|deploy|refund|payment/i;

/** 결제·운영 직전 멈춤 — 마지막 턴에 SendMessage(참모에게 물음)를 했고, 그 뒤 참모 답이 안 왔고, 마지막 답이 돈·운영 얘기 */
export function heldAtGate(a?: Activity): boolean {
  if (!a?.messaged) return false;
  const start = turnStart(a);
  if (start && a.messaged < start) return false; // 이번 턴이 아니라 옛 턴에 보낸 것
  const said = `${a.reply?.text ?? ''} ${a.reply?.tail ?? ''} ${a.reply?.ask?.q ?? ''}`;
  return GATE.test(said);
}

/** 정리 전 프로젝트 세션에게 — 한 줄(입력칸에 치는 말이라 줄바꿈 없이) */
export const projectHandoffText = (path: string, git: boolean, alt: string) =>
  `[앱] 대화가 길어져서 곧 정리(/compact)할게. 그 전에 ${path} 의 '## 지금 하던 일' 칸(없으면 만들어)에 지금 하던 일·남은 단계·기다리는 답·이 일에 걸린 조건(머지 금지·물어볼 것 등)·다음 할 일을 적어(그 칸만 덮어쓰고 다른 칸은 그대로).${git ? ' 커밋은 하지 말고 파일만 고쳐.' : ''} 그 파일 고치기가 막히면(워크트리 격리 등) 같은 내용을 ${alt} 에 적어. 다 적으면 '적었어' 한 줄만 답해.`;

/** /compact 요약 지시 — 요약 뒤 starter 를 다시 읽고 맡은 일 조건을 지키게 */
export const projectCompactText = (path: string, alt: string) =>
  `/compact 하던 일·남은 단계·기다리는 답·맡은 일의 조건(머지 금지·push 금지·물어볼 것)을 빠뜨리지 말고 요약해. 요약 뒤에는 먼저 ${path} 의 '지금 하던 일' 칸(거기 못 적었으면 ${alt})을 다시 읽고, 맡은 일의 조건을 지키면서 이어서 해.`;

/** 정리 직후 맡긴 참모에게 — 건 조건을 다시 보낼 수 있게 */
export const projectNoticeText = (name: string, id: string, before: number, after: number, wrote: string, task?: { id: string; title?: string }) =>
  `[앱] ${name}(${id}) 세션 대화를 정리했어(${before}% → ${after}%, 하던 일은 ${wrote} 에 적음).${task ? ` 마지막으로 맡긴 일 ${task.id}${task.title ? `(${task.title})` : ''}에 건 조건(머지 금지·물어볼 것)이 빠졌을 수 있으니 필요하면 다시 보내.` : ''}`;

// 결정 대기함 답장 순서 — 막힘 확인 → (작업 물음이면) 아직 기다리나 → 세션에 치기 → 기록. 실패는 던진다:
// 부른 쪽(InboxRow)이 친 글을 남기고 그 줄에 까닭을 띄운다(2026-11-01 ux-daily — 실패를 삼켜 글만 지워졌다).
// '아직 기다리나'는 폰 /api/task-answer 와 같은 판단(Rust task_answer_state) — 폰에서 먼저 답한 결정을 또 치지 않게
import { tr } from '../i18n';

export async function replyInbox(o: {
  /** 답장을 못 넣는 까닭(replyBlocked) — 있으면 안 친다 */
  why: string | null;
  taskId?: string;
  waiting: (task: string) => Promise<boolean>;
  send: () => Promise<void>;
  record: () => Promise<void>;
  /** 작업 id 없는 물음(참모 물어봄)을 목록에서 치우기 */
  dismiss: () => void;
}): Promise<void> {
  if (o.why) throw new Error(o.why);
  if (o.taskId && !(await o.waiting(o.taskId))) throw new Error(tr('이미 답했어요', 'Already answered'));
  await o.send();
  if (o.taskId) await o.record();
  else o.dismiss();
}

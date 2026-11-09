// 대화 첨부 — 여러 장 나눠 보내기·칩 글(11-05 '사진 여러 장을 한 번에 올리면 안 간다')
import { tr } from '../i18n';
import { fileSize } from './teamChat';

/** 말 하나에 붙는 파일 수 — Rust e2e_envelope MAX_FILES. 받는 쪽(0.4.8 포함)은 넘는 말의 파일을 통째 버린다 */
export const MAX_SAY_FILES = 10;

/** from = 이 묶음 첫 파일이 전체에서 몇 번째인가(못 보낸 묶음의 칩을 되살릴 때) */
export type Batch<F> = { text: string; files: F[]; from: number };

/** 10장씩 — 글은 첫 묶음에만. 10장까지는 한 번 */
export function sendBatches<F>(text: string, files: F[], max = MAX_SAY_FILES): Batch<F>[] {
  if (files.length <= max) return [{ text, files, from: 0 }];
  const out: Batch<F>[] = [];
  for (let i = 0; i < files.length; i += max) out.push({ text: i === 0 ? text : '', files: files.slice(i, i + max), from: i });
  return out;
}

/** 칩 아래 작은 글 — 대기 · 올리는 중(몇 %) · 못 올림 · 다 올리면 크기 */
export function attNote(a: { wait?: boolean; busy?: boolean; err?: string; size?: number }, pct: number | null): string {
  if (a.err) return tr('못 올림', 'Failed');
  if (a.busy) return pct === null ? tr('올리는 중', 'Uploading') : tr(`올리는 중 ${pct}%`, `Uploading ${pct}%`);
  if (a.wait) return tr('대기', 'Waiting');
  return a.size !== undefined ? fileSize(a.size) : '';
}

type Up = { room: string; name: string; done: number; total: number; error: string };

/** 그 방·그 이름의 올리는 중 줄(Rust team_locker_app Upload) → 몇 %. 끝(100%)은 서버 마무리 전이라 99 */
export function upPct(ups: Up[], room: string, name: string): number | null {
  const u = ups.find((x) => x.room === room && x.name === name && !x.error && x.total > 0);
  return u ? Math.min(99, Math.floor((u.done * 100) / u.total)) : null;
}

/** 첨부 차례 줄 — 넣은 순서대로 한 장씩(겹치지 않게), 기다리는 동안 뺀 것은 건너뛰고 한 장 실패가 다음 장을 막지 않는다.
 *  '뺐나'는 이 줄이 따로 기억한다(화면 목록으로 보면 다시 그리기 전이라 방금 넣은 칩을 다 건너뛰었다, 11-05) */
export function attachQueue(run: (key: string) => Promise<void>) {
  let tail: Promise<void> = Promise.resolve();
  const dropped = new Set<string>();
  return {
    add(keys: string[]): Promise<void> {
      for (const k of keys) tail = tail.then(() => (dropped.has(k) ? undefined : run(k))).catch(() => {});
      return tail;
    },
    drop(key: string) { dropped.add(key); },
  };
}

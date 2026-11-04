/** 팀 파일 받기 진행(Rust team_down) — 대화 파일 말풍선·팀 보관함 카드가 막대·멈추기·다 받음·실패 이유를 그린다(11-01 사용자 시안 승인).
 *  막대 옆 글은 '받은 / 전체' 숫자만(전체와 같은 단위) — 남은 시간은 안 쓴다 */
import { tr } from '../i18n';
import { fileSize } from './teamChat';
import { fmtBytes } from './teamLocker';

export type TeamDown = {
  team: string;
  id: string;
  /** save = 내 폴더에 저장 · open = 눌러서 열기 */
  mode: 'save' | 'open';
  done: number;
  total: number;
  state: 'going' | 'done' | 'failed';
  why: '' | 'net' | 'disk' | 'gone' | 'stopped' | 'other';
  error: string;
  /** 다 받은 자리 */
  path: string;
};

/** 전체 크기에 맞춘 단위 — 받은 것도 같은 단위로. bin = 1024 단위(팀 보관함 칸이 원래 크기를 fmtBytes 로 쓴다 — 같은 줄에서 숫자가 바뀌어 보이지 않게) */
function unit(total: number, bin: boolean): [number, string, number] {
  const k = bin ? 1024 : 1000;
  if (total >= k ** 3) return [k ** 3, 'GB', 1];
  if (total >= k ** 2) return [k ** 2, 'MB', 0];
  return [k, 'KB', 0];
}

export function downProgress(d: TeamDown, bin = false): string {
  if (d.total <= 0) return '';
  const [n, u, dp] = unit(d.total, bin);
  const f = (v: number) => (dp ? (v / n).toFixed(dp) : String(Math.round(v / n)));
  return `${f(Math.min(d.done, d.total))} / ${f(d.total)}${u}`;
}

export function downRatio(d: TeamDown): number {
  return d.total > 0 ? Math.min(1, Math.max(0, d.done / d.total)) : 0;
}

/** 한 파일에 보일 줄 — 받는 중 → 저장(다 받음·실패) → 여는 길 실패. 여는 길이 다 받은 건 Rust 가 이미 뺐다 */
export function downOf(list: TeamDown[], id: string): TeamDown | undefined {
  const mine = list.filter((d) => d.id === id);
  return mine.find((d) => d.state === 'going') ?? mine.find((d) => d.mode === 'save') ?? mine.find((d) => d.state === 'failed');
}

function whyText(d: TeamDown): string {
  switch (d.why) {
    case 'net': return tr('인터넷이 끊겼어요', 'Connection lost');
    case 'disk': return tr('저장 공간이 모자라요', 'Not enough storage');
    case 'gone': return tr('올린 사람이 지웠어요', 'The uploader removed it');
    case 'stopped': return tr('받기를 멈췄어요', 'Download stopped');
    default: return tr(`받지 못했어요 — ${d.error}`, `Couldn't download — ${d.error}`);
  }
}

/** 이름 아래 한 줄 — err 면 상태 색(--danger-ink) */
export function downStatus(d: TeamDown, bin = false): { text: string; err: boolean } {
  if (d.state === 'failed') return { text: whyText(d), err: true };
  const size = bin ? fmtBytes(d.total) : fileSize(d.total);
  if (d.state === 'done') return { text: tr(`${size} · 받았어요`, `${size} · Downloaded`), err: false };
  return { text: downProgress(d, bin), err: false };
}

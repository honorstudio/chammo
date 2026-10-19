// 끌 때 Craft 저장 글(2026-10-19 끄기 QA) — 종료 창이 무엇을 몇 초째 저장하는지 보여 준다
import { tr } from '../i18n';

export function savingText(names: string[], secs: number): string {
  const who = names.join('·');
  const base = tr(`${who} 저장 중`, `Saving ${who}`);
  return secs > 0 ? `${base} · ${tr(`${secs}초`, `${secs}s`)}` : base;
}

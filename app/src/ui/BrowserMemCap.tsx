// 설정 > 참모 브라우저 아래 한 줄 — 메모리 상한(프로필당·전체 GB). 넘으면 래퍼가 제일 큰 탭을 닫고, 또 넘으면 그 크롬을 끈다(tools/chammo-browser/src/memcap.js).
// 값은 칸을 떠날 때·Enter 에 저장(Rust browser_memcap_set 이 0.5~256 으로 막고 전체를 프로필 이상으로 맞춘다)
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { tr } from '../i18n';

type Caps = { profileGb: number; totalGb: number };

/** 이 줄을 띄울까 — 감시(memcap.js)는 ps 로 재서 윈도우에선 안 돈다. 윈도우엔 아무 일도 안 하는 칸을 안 띄운다 */
export const memCapShown = (state: string, win: boolean) => state === 'ok' && !win;

export function BrowserMemCap() {
  const [saved, setSaved] = useState<Caps | null>(null);
  const [draft, setDraft] = useState<{ profileGb: string; totalGb: string } | null>(null);
  const take = (c: Caps) => { setSaved(c); setDraft({ profileGb: String(c.profileGb), totalGb: String(c.totalGb) }); };
  useEffect(() => { void invoke<Caps>('browser_memcap_get').then(take, () => {}); }, []);
  if (!saved || !draft) return null;
  const save = () => {
    const next = { profileGb: Number(draft.profileGb), totalGb: Number(draft.totalGb) };
    if (next.profileGb === saved.profileGb && next.totalGb === saved.totalGb) return;
    void invoke<Caps>('browser_memcap_set', { caps: next }).then(take, () => take(saved));
  };
  const field = (k: keyof Caps, label: string) => (
    <input type="number" inputMode="decimal" min={0.5} max={256} step={0.5} value={draft[k]} aria-label={label} title={label}
      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
  );
  return (
    <div className="su-memcap">
      <span>{tr('메모리 상한', 'Memory limit')}</span>
      {field('profileGb', tr('프로필당 GB', 'GB per profile'))}
      <span>{tr('GB · 전체', 'GB · total')}</span>
      {field('totalGb', tr('전체 GB', 'GB in total'))}
      <span>GB</span>
    </div>
  );
}

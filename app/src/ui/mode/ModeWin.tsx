// 참모 모드 따로 창(mode.html) — 머리 오른쪽 압정 = '항상 위'. 기억은 Rust(modes.json top), 메뉴·scripts/app mode top 으로 바꿔도 밀림(top)으로 따라온다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { tr } from '../../i18n';
import { modeTop, type ModeRow } from '../../domain/modeTree';
import { IconPin } from '../Icons';
import { ModeView } from './ModeView';
import { MODE_EVENT, type ModeMsg } from './modeBus';

export function ModeWin({ name }: { name: string }) {
  const [top, setTop] = useState(false);
  useEffect(() => {
    void invoke<ModeRow[]>('mode_list').then((rows) => setTop(modeTop(rows, name)), () => {});
    const on = (e: Event) => setTop((cur) => modeTop(cur, name, (e as CustomEvent<ModeMsg>).detail));
    window.addEventListener(MODE_EVENT, on);
    return () => window.removeEventListener(MODE_EVENT, on);
  }, [name]);
  const flip = () => {
    const next = !top;
    setTop(next);
    void invoke('mode_top', { name, on: next }).catch(() => setTop(!next));
  };
  const label = tr('항상 위', 'Always on top');
  return (
    <div className="mdv-win">
      <header className="mdv-win-head">
        <button className={`ib mdv-pin${top ? ' on' : ''}`} aria-pressed={top} aria-label={label} title={label} onClick={flip}><IconPin /></button>
      </header>
      <ModeView name={name} />
    </div>
  );
}

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { IconClose, IconMaximize, IconRestore } from '../Icons';
import { Grip } from '../TaskPanel';
import { ReaderView } from './Reader';
import { tr } from '../../i18n';

/**
 * 리더를 보고 있나 = 마지막으로 만진 게 리더(탭 줄·문서 프레임 클릭, Ctrl+Tab). 터미널을 누르면 풀린다.
 * 포커스만 보면 Ctrl+Tab 으로 탭을 넘기는 동안 포커스가 터미널에 남아 ⌘W 가 세션을 끄려 했다(사용자 2026-09-28)
 */
let lastReader = false;
export function markReader(on: boolean) {
  lastReader = on;
  document.querySelector('.reader-panel')?.classList.toggle('active', on);
}
export const readerFocused = () => lastReader && !!document.querySelector('.reader-panel');

/**
 * 작업 패널 왼쪽의 리더 패널(사용자 2026-09-28: 새 창은 불편, 필요할 때 열고 닫는 패널로). 탭은 끌어서 새 창으로 뺐다 넣었다.
 * 자리(웹뷰 좌표)를 Rust 에 알려 준다 — 떼어 낸 창의 탭을 여기 놓았는지 판단용
 */
/** full = 크게(비서 화면 자리까지 덮는다), 작게 = 작업 패널 옆 폭(사용자 2026-09-28) */
export function ReaderPanel({ width, onWidth, full, onFull, onClose }: { width: number; onWidth: (w: number) => void; full: boolean; onFull: () => void; onClose: () => void }) {
  const box = useRef<HTMLElement>(null);
  // 무엇을 마지막으로 만졌나 — 리더 안을 누르면 리더, 밖(터미널 등)을 누르거나 포커스가 밖으로 가면 해제.
  // 문서 프레임(다른 출처) 안 클릭은 부모에 pointerdown 이 안 온다 → 창이 blur 되고 포커스가 프레임이면 리더
  useEffect(() => {
    const down = (e: PointerEvent) => markReader(!!(e.target as Element | null)?.closest?.('.reader-panel'));
    const focusin = (e: FocusEvent) => markReader(!!(e.target as Element | null)?.closest?.('.reader-panel'));
    const blur = () => setTimeout(() => { if (document.activeElement?.closest('.reader-panel')) markReader(true); }, 0);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('focusin', focusin, true);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('focusin', focusin, true); window.removeEventListener('blur', blur); markReader(false); };
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const report = () => { const r = el.getBoundingClientRect(); void invoke('reader_dock_rect', { rect: [r.left, r.top, r.width, r.height] }).catch(() => {}); };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    return () => { ro.disconnect(); window.removeEventListener('resize', report); void invoke('reader_dock_rect', { rect: null }).catch(() => {}); };
  }, [full]);
  return (
    <aside className={`reader-panel ${full ? 'full' : ''}`} ref={box} tabIndex={-1} style={full ? undefined : { flex: `0 0 ${width}px`, width }}>
      {!full && <Grip width={width} onWidth={onWidth} min={320} max={1400} />}
      <ReaderView surface="dock" actions={<>
        <button onClick={onFull} title={full ? tr('작게 — 작업 패널 옆으로 (⌘⇧E)', 'Smaller — next to the task panel (⌘⇧E)') : tr('크게 — 가운데 화면 전체로 (⌘⇧E)', 'Larger — fill the center (⌘⇧E)')} aria-label={full ? tr('작게', 'Smaller') : tr('크게', 'Larger')}>{full ? <IconRestore /> : <IconMaximize />}</button>
        <button onClick={onClose} title={tr('리더 패널 닫기 (⌘E)', 'Close reader panel (⌘E)')} aria-label={tr('닫기', 'Close')}><IconClose /></button>
      </>} />
    </aside>
  );
}

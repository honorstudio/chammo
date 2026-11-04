import { useEffect, useRef } from 'react';
import type { LoadReport, SysLoad } from '../domain/load';
import { tr } from '../i18n';
import { IconClose } from './Icons';
import { LoadPage } from './LoadPage';

/** 바깥을 눌러도 안 닫는 곳 — 글 치는 칸(채팅 입력·터미널)과 부하 칩. 창을 띄워 둔 채 참모에게 "이거 꺼 줘" 할 수 있게 */
export const keepsOpen = (t: Element | null): boolean => !!t?.closest('input, textarea, [contenteditable="true"], .xterm, .load-chip');

/**
 * 자세히 보기(세션별 부하) — 가운데를 덮지 않는 떠 있는 창. 칩 아래 왼쪽 끝에 붙고(채팅 칸은 오른쪽이라 안 가린다), 막는 바탕이 없어 채팅을 그대로 쓴다.
 * Esc·닫기·바깥 누르기로 닫힌다(2026-11-01 사용자 "가운데를 통째로 덮는 건 과하다")
 */
export function LoadFloat({ anchor, sys, report, onOpen, onKilled, onClose }: {
  anchor: DOMRect; sys: SysLoad | null; report: LoadReport | null;
  onOpen: (id: string) => void; onKilled: () => void; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current(); };
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (box.current?.contains(t) || keepsOpen(t)) return;
      closeRef.current();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', down, true);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', down, true); };
  }, []);
  const width = Math.min(480, Math.max(360, window.innerWidth * 0.42));
  return (
    <div ref={box} className="ld-float" role="dialog" aria-label={tr('세션별 부하', 'Load by session')}
      style={{ top: anchor.bottom + 6, left: 8, width }}>
      <LoadPage sys={sys} report={report} onOpen={(id) => { onOpen(id); onClose(); }} onKilled={onKilled} />
      {/* 머리 위에 얹히게 LoadPage 뒤에(z-index 숫자 금지 — zLayers.test) */}
      <button type="button" className="lc-ib ld-float-close" aria-label={tr('닫기', 'Close')} title={tr('닫기 (Esc)', 'Close (Esc)')} onClick={onClose}><IconClose /></button>
    </div>
  );
}

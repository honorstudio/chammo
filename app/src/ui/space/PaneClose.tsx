// 기능 화면 닫기 — 레일 더보기(···)로 여는 예약·리플레이·도구·하니터·리뷰가 X·새로고침·없음으로 제각각이던 것을 하나로(2026-11-01 사용자
// "레일만 남긴 사람은 다시 들어가서 닫기가 힘듦"). 스페이스 오른쪽 위 한 자리·한 크기, 각 화면 머리 줄의 다른 단추는 그 왼쪽(space.css has-pclose)
import { useEffect, useRef } from 'react';
import { paneEscCloses } from '../../domain/paneClose';
import { tr } from '../../i18n';
import { IconClose } from '../Icons';
import { IconButton } from '../kit/IconButton';

/** 글 칸·터미널·문서 편집기 — 여기서 친 Esc 는 그 칸 것(채팅 Esc = 하던 일 멈추기) */
const EDITABLE = '.xterm, input, textarea, select, [contenteditable="true"], .bn-editor';
/** 위에 뜬 창 — 그 창이 Esc 를 먼저 가진다 */
const OVERLAY = '.rail-pop, .od-back, .dash-preview, .osh, [aria-modal="true"]';

export function PaneClose({ onClose }: { onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // 위에 뜬 창은 누른 순간(캡처 단계)에 본다 — 더보기 펼침은 자기 Esc 로 먼저 사라져서 끝(거품 단계)에 보면 없다
    let overlay = false;
    const first = (e: KeyboardEvent) => { if (e.key === 'Escape') overlay = !!document.querySelector(OVERLAY); };
    // 판단은 끝에서 — 채팅 Esc(하던 일 멈추기)처럼 다른 곳이 쓴 Esc(preventDefault)를 보려고
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!paneEscCloses({ key: e.key, composing: e.isComposing, prevented: e.defaultPrevented, editable: !!t?.closest?.(EDITABLE), overlay })) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', first, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', first, true); window.removeEventListener('keydown', key); };
  }, []);
  return <IconButton tone="line" className="pane-close" label={tr('닫기', 'Close')} title={tr('닫기 (Esc)', 'Close (Esc)')} onClick={onClose}><IconClose /></IconButton>;
}

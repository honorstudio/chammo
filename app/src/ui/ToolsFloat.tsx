import { useEffect, useRef, useState } from 'react';
import { openTarget } from '../data/tauri';
import { tr } from '../i18n';
import { IconClose } from './Icons';
import { ToolsPage } from './space/ToolsPage';

/**
 * 도구 화면을 떠 있는 창으로 — 터미널 뷰 'adopt'(붙인 세션 하나)는 채팅 뷰에도 스페이스가 없어 위 막대 도구 아이콘이 아무것도 안 했다
 * (2026-10-05 fix/tools-topbar 부채 ①). 하니터 float 와 같은 자리(탑바 아래 앱 전체). SKILL.md 열기는 기본 앱으로
 */
export function ToolsFloat({ root: first, roots, sessions, computerUse, onClose }: {
  root: string;
  roots: { name: string; root: string }[];
  sessions: { id: string; kind: string; state: string; cwd: string; waitingFor?: string }[];
  computerUse?: { all: boolean; setAll: (on: boolean) => void };
  onClose: () => void;
}) {
  const [root, setRoot] = useState(first);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="hn-panel float tl-float">
      <button className="ib tl-float-close" aria-label={tr('도구 닫기', 'Close tools')} title={tr('닫기 (Esc)', 'Close (Esc)')} onClick={onClose}><IconClose /></button>
      <ToolsPage key={root} root={root} roots={roots} onRoot={setRoot}
        sessions={sessions.filter((s) => s.cwd === root || s.cwd.startsWith(`${root}/`))}
        onOpen={(p) => void openTarget('file', p)} computerUse={computerUse} />
    </div>
  );
}

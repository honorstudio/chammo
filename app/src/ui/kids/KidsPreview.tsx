// 맥 앱 안 키즈 화면 미리보기(셋째 조각) — 패드 없이도 아이 화면을 본다. 같은 KidsScreen 을 앱 명령(kids_*)으로 띄우고,
// 말을 넣으면 진짜 아이 세션에 간다(보호자 채팅 한 줄기에도 뜬다). 패드 크기 틀(가로·세로), 닫기 = Esc·닫기 단추·구석 3초
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { kidsLog, kidsRead, kidsSay, kidsWork, kidsWorks } from '../../data/tauri';
import { tr } from '../../i18n';
import { IconClose } from '../Icons';
import { KidsScreen, type KidsApi } from './KidsScreen';

export function KidsPreview({ kidKey, avatar, onClose }: { kidKey: string; avatar: unknown; onClose: () => void }) {
  const [port, setPort] = useState(false);
  const api = useMemo<KidsApi>(() => ({
    me: async () => { const v = await kidsRead(); const o = v.orchs[kidKey]; return { key: kidKey, on: v.on && !!o, child: o?.child, avatar }; },
    say: (text, cid) => kidsSay(kidKey, text, cid),
    log: async () => (await kidsLog(kidKey)).filter((r) => r.who === 'kid' || r.who === 'assistant'),
    leave: async () => { onClose(); return { ok: true as const }; },
    pinless: true, // 맥에서 보는 사람은 이미 보호자
    works: () => kidsWorks(kidKey),
    work: (name) => kidsWork(kidKey, name),
  }), [kidKey, avatar, onClose]);
  useEffect(() => {
    // 먼저 받아 막는다 — 뒤 프로필 창까지 Esc 로 같이 닫히지 않게
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } }; // 같은 window 의 프로필 창 Esc 보다 먼저 걸려도 막는다
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return createPortal(
    <div className="kzp-back" role="dialog" aria-label={tr('아이 화면 미리보기', 'Kids screen preview')}>
      <div className="kzp-bar">
        <button type="button" onClick={onClose} aria-label={tr('닫기', 'Close')} title={tr('닫기', 'Close')}><IconClose /></button>
        <button type="button" onClick={() => setPort((p) => !p)} aria-label={port ? tr('가로로', 'Landscape') : tr('세로로', 'Portrait')} title={port ? tr('가로로', 'Landscape') : tr('세로로', 'Portrait')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x={port ? 7 : 4} y={port ? 4 : 7} width={port ? 10 : 16} height={port ? 16 : 10} rx="2" /><path d="M20 15a8 8 0 0 1-5 5M4 9a8 8 0 0 1 5-5" /></svg>
        </button>
      </div>
      <div className={`kzp-frame ${port ? 'port' : 'land'}`}><KidsScreen api={api} preview /></div>
    </div>,
    document.body,
  );
}

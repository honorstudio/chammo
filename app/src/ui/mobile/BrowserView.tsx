// 세션 브라우저 보기 — 읽기만(누르기·치기 없음, 2026-10-03). 화면이 보일 때만 맥에서 새 프레임을 묻는다(묻는 동안만 맥이 받는다).
// 폰은 데이터가 아까워서 일하는 중 0.7초·조용하면 2초마다. 화면을 누르면 바닥 전체를 덮어 크게 — 거기선 핀치로 확대(ZoomBox)
import { useEffect, useRef, useState } from 'react';
import { browserFrame } from '../../data/web';
import { unpackFrame, type Live } from '../../domain/agentBrowser';
import { ZoomBox } from './ZoomBox';

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export function BrowserView({ live }: { live: Live }) {
  const [src, setSrc] = useState('');
  const [big, setBig] = useState(false);
  const seq = useRef(0);
  const url = useRef('');
  const busy = useRef(live.busy);
  busy.current = live.busy;
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const pull = async () => {
      if (!document.hidden) {
        try {
          const f = unpackFrame(await browserFrame(live.profile, seq.current));
          if (alive && f && f.seq > seq.current) {
            seq.current = f.seq;
            const next = URL.createObjectURL(new Blob([f.jpeg as BlobPart], { type: 'image/jpeg' }));
            if (url.current) URL.revokeObjectURL(url.current);
            url.current = next;
            setSrc(next);
          }
        } catch { /* 브라우저가 닫히는 중 — 다음 차례에 */ }
      }
      if (alive) timer = window.setTimeout(() => void pull(), busy.current ? 700 : 2000);
    };
    void pull();
    return () => { alive = false; window.clearTimeout(timer); if (url.current) URL.revokeObjectURL(url.current); url.current = ''; };
  }, [live.profile]);
  return (
    <div className="m-br">
      <button type="button" className="m-br-shot" onClick={() => setBig(true)} aria-label="브라우저 화면 크게">
        {src ? <img src={src} alt={live.title || '세션 브라우저 화면'} /> : <span className="m-muted m-sm">화면 받는 중…</span>}
      </button>
      {big && (
        <div className="m-view" role="dialog" aria-label="세션 브라우저 화면">
          <div className="m-picker-head">
            <b className="m-view-title">{live.title || host(live.url)}</b>
            <button type="button" className="m-plain" onClick={() => setBig(false)}>닫기</button>
          </div>
          <div className="m-view-body">{src && <ZoomBox><img src={src} alt={live.title || '세션 브라우저 화면'} /></ZoomBox>}</div>
        </div>
      )}
      <div className="m-br-line">
        {live.busy && <span className="m-live-dots" aria-hidden><i /><i /><i /></span>}
        <span className="m-br-title">{live.title || host(live.url)}</span>
        <span className="m-br-host">{host(live.url)}</span>
      </div>
      {live.tool && <div className="m-muted m-sm m-br-tool">{live.tool}</div>}
    </div>
  );
}

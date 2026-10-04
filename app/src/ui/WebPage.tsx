import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { addressToUrl } from '../domain/webUrl';
import { tr } from '../i18n';
import { IconNext, IconOpen, IconPrev, IconRefresh } from './Icons';
import './webpage.css';

type WebState = { url: string; loading: boolean; open: boolean };

/**
 * 주소 미리보기 — scripts/show http(s) 주소를 앱 안에(2026-10-02 사용자 "인앱에서 띄워 주고 '크롬에서 보기'").
 * 페이지는 DOM 이 아니라 Rust 가 이 칸 자리에 붙이는 자식 웹뷰(webpage.rs)다 — 그래서 칸 네모를 매 프레임 재서 넘기고,
 * 위에 확인 창(.od-back)이 뜨면 숨긴다(웹뷰는 DOM 위에 떠서 가린다). 바깥 페이지는 앱 명령·파일 프로토콜을 못 부른다
 */
export function WebPage({ url }: { url: string }) {
  const [owner] = useState(() => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const box = useRef<HTMLDivElement>(null);
  const [addr, setAddr] = useState(url);
  const [loading, setLoading] = useState(true);
  const [bad, setBad] = useState(false);
  const [err, setErr] = useState('');
  const editing = useRef(false);
  const cur = useRef(url);

  const rect = () => {
    const r = box.current?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height, vh: window.innerHeight } : null; // vh — 맥 제목줄 높이 재기(webpage.rs content_origin)
  };
  useEffect(() => {
    const r = rect();
    if (!r) return;
    setErr('');
    setAddr(url);
    cur.current = url;
    void invoke('web_open', { url, owner, ...r }).catch((e) => setErr(String(e)));
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void invoke('web_close', { owner }).catch(() => {}), [owner]);

  // 자리 따라가기 — 모달이 미끄러져 들어오거나 크기를 끌면 칸이 움직인다. 바뀔 때만 보낸다
  useEffect(() => {
    let last = '';
    let shown = true;
    let id = 0;
    const tick = () => {
      const r = rect();
      const cover = !!document.querySelector('.od-back'); // 확인 창 — 웹뷰가 가리지 않게
      const show = !!r && r.w > 0 && r.h > 0 && !cover;
      if (show !== shown) { shown = show; void invoke('web_visible', { owner, visible: show }).catch(() => {}); }
      if (r && show) {
        const k = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)},${r.vh}`;
        if (k !== last) { last = k; void invoke('web_bounds', { owner, ...r }).catch(() => {}); }
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [owner]); // eslint-disable-line react-hooks/exhaustive-deps

  // 지금 주소·불러오는 중 — 페이지 안에서 옮겨 가면 주소 줄이 따라간다(치는 중엔 안 덮는다)
  useEffect(() => {
    const id = window.setInterval(() => void invoke<WebState>('web_state', { owner }).then((s) => {
      if (!s.open) return;
      setLoading(s.loading);
      cur.current = s.url;
      if (!editing.current) setAddr(s.url);
    }).catch(() => {}), 400);
    return () => window.clearInterval(id);
  }, [owner]);

  const go = () => {
    const u = addressToUrl(addr);
    if (!u) { setBad(true); return; }
    setBad(false);
    editing.current = false;
    (document.activeElement as HTMLElement | null)?.blur();
    void invoke('web_go', { owner, url: u }).catch((e) => setErr(String(e)));
  };
  const nav = (action: 'back' | 'forward' | 'reload') => void invoke('web_nav', { owner, action }).catch(() => {});
  const chrome = () => void invoke<string>('open_in_chrome', { url: cur.current }).catch((e) => setErr(String(e)));

  return (
    <div className="wp">
      <div className={`wp-bar ${loading ? 'wp-loading' : ''}`}>
        <button className="wp-ic" onClick={() => nav('back')} title={tr('뒤로', 'Back')} aria-label={tr('뒤로', 'Back')}><IconPrev /></button>
        <button className="wp-ic" onClick={() => nav('forward')} title={tr('앞으로', 'Forward')} aria-label={tr('앞으로', 'Forward')}><IconNext /></button>
        <button className="wp-ic" onClick={() => nav('reload')} title={tr('새로고침', 'Reload')} aria-label={tr('새로고침', 'Reload')}><IconRefresh /></button>
        <input className={`wp-addr ${bad ? 'wp-bad' : ''}`} value={addr} spellCheck={false} aria-label={tr('주소', 'Address')}
          title={bad ? tr('http(s) 주소만 열 수 있어요', 'Only http(s) addresses') : undefined}
          onFocus={(e) => { editing.current = true; e.currentTarget.select(); }}
          onBlur={() => { editing.current = false; setBad(false); setAddr(cur.current); }}
          onChange={(e) => { setAddr(e.target.value); setBad(false); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') { e.preventDefault(); go(); }
            if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } // 주소만 되돌리고 미리보기는 안 닫는다
          }} />
        <button className="wp-ic" onClick={chrome} title={tr('크롬에서 열기', 'Open in Chrome')} aria-label={tr('크롬에서 열기', 'Open in Chrome')}><IconOpen /></button>
      </div>
      <div className="wp-page" ref={box}>{err && <div className="wp-err">{err}</div>}</div>
    </div>
  );
}

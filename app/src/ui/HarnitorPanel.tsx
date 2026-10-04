import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { bridgeCommand, harnitorUrl, harnitorViewWord, readBridgeMsg, themeVars, type HarnitorSel } from '../domain/harnitor';
import { reportView } from './viewReport';
import { tr } from '../i18n';
import { IconClose } from './Icons';

/**
 * 하니터 — 하네스(스킬·훅·MCP·플러그인·CLAUDE.md)를 보고 끄고 켜고 되돌리는 화면(2026-10-01 사용자 "하니터 가보자").
 * 화면은 하니터 것 그대로(iframe, harnitor://), 여기는 다리 반대편: iframe 이 부른 명령을 harnitor_* 로 불러 답을 돌려주고,
 * ~/.claude 가 바뀌면(Rust 가 window.__harnitorChanged) · 4초마다 세션 목록을 하니터 이벤트로 넘긴다. 색은 참모 테마 토큰으로 덮는다.
 * 자리: 채팅 뷰면 스페이스(왼쪽) 칸 — 오른쪽 채팅은 그대로라 보면서 참모에게 "이거 꺼 줘" 한다(2026-10-01 사용자). float = 스페이스가 없을 때 탑바 아래 전체
 */
/** restore = 이 탭에서 전에 고른 프로젝트·항목(돌아오면 되살린다), onView = 고른 게 바뀔 때마다 — 참모가 지금 보는 화면을 안다(2026-10-02 사용자) */
export function HarnitorPanel({ onClose, float = false, restore, onView }: { onClose: () => void; float?: boolean; restore?: HarnitorSel; onView?: (v: HarnitorSel) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const viewRef = useRef(onView);
  viewRef.current = onView;
  const restoreRef = useRef(restore);

  useEffect(() => {
    const win = () => frame.current?.contentWindow ?? null;
    const post = (m: Record<string, unknown>) => win()?.postMessage(m, '*');
    const event = (name: string, payload: unknown = null) => post({ harnitor: 'event', name, payload });
    // 참모 토큰 값을 읽어 넘긴다 — 밝은·어두운이 바뀌면 다시(iframe 은 부모 CSS 변수를 못 읽는다)
    const sendTheme = () => {
      const css = getComputedStyle(document.documentElement);
      post({ harnitor: 'theme', vars: themeVars((n) => css.getPropertyValue(n)) });
    };
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', sendTheme);
    const on = (e: MessageEvent) => {
      if (!e.source || e.source !== win()) return;
      const m = readBridgeMsg(e.data);
      if (!m) return;
      if (m.kind === 'esc') { closeRef.current(); return; }
      if (m.kind === 'ready') {
        sendTheme();
        const r = restoreRef.current;
        if (r?.path) post({ harnitor: 'restore', path: r.path, item: r.item });
        return;
      }
      if (m.kind === 'view') {
        const { kind: _k, ...v } = m;
        reportView({ harnitor: harnitorViewWord(v) || undefined });
        viewRef.current?.(v);
        return;
      }
      if (m.kind !== 'invoke') return;
      const name = bridgeCommand(m.cmd);
      if (!name) {
        post({ harnitor: 'reply', id: m.id, ok: false, error: tr('참모 안에서는 안 쓰는 기능이에요 — 참모에게 말로 시켜 주세요', 'Not available inside Chammo — ask your assistant instead') });
        return;
      }
      invoke(name, m.args).then(
        (value) => post({ harnitor: 'reply', id: m.id, ok: true, value }),
        (err: unknown) => post({ harnitor: 'reply', id: m.id, ok: false, error: String(err) }),
      );
    };
    window.addEventListener('message', on);
    const w = window as unknown as { __harnitorChanged?: () => void };
    w.__harnitorChanged = () => event('harness-changed');
    // 세션은 파일이 아니라 프로세스라 감시로 안 잡힌다 — 열려 있는 동안만 4초마다(하니터 앱과 같은 간격)
    const tick = window.setInterval(() => {
      void invoke('harnitor_sessions').then((list) => event('sessions-changed', list), () => {});
    }, 4000);
    // 채팅 칸에서 친 Esc(세션 멈추기 등)는 채팅 것 — 글 칸 밖에서 누른 Esc 만 닫는다
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable);
      if (e.key === 'Escape' && !e.defaultPrevented && !typing && !document.querySelector('.od-back')) closeRef.current();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('message', on);
      window.removeEventListener('keydown', key);
      scheme.removeEventListener('change', sendTheme);
      window.clearInterval(tick);
      delete w.__harnitorChanged;
    };
  }, []);

  return (
    <div className={`hn-panel ${float ? 'float' : ''}`}>
      <header className="hn-top">
        <b className="hn-title">{tr('하니터', 'Harnitor')}</b>
        <span className="hn-sub">{tr('하네스 — 스킬·훅·MCP·플러그인 보기·끄고 켜기·되돌리기. 바꾼 건 새로 켜는 세션부터 먹어요', 'Your harness — skills, hooks, MCP, plugins: view, toggle, undo. Changes apply to newly started sessions')}</span>
        <span className="hn-sp" />
        <button className="hn-close" onClick={onClose} title={tr('닫기 (Esc)', 'Close (Esc)')}><IconClose />{tr('닫기', 'Close')}</button>
      </header>
      <iframe ref={frame} className="hn-frame" src={harnitorUrl()} title={tr('하니터', 'Harnitor')} />
    </div>
  );
}

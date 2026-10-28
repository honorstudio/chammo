// 세션 브라우저 스페이스 칸(2026-10-27 인앱 브라우저 시안 A) — 탭 줄 아이콘을 누르면 스페이스 칸 전체가 그 세션 브라우저.
// 머리줄 = 브라우저 안 탭(참모 따라가기)·더보기·숨기기 · 가운데 = 네이티브 비추기(가짜 화면 위 크롬 창을 SCK 로, Rust browser_pane) · 아래 = 하는 일 한 줄 + 주소.
// 칸은 비워 두고 비추기가 그 위에 얹힌다(Craft 칸과 같은 길, ui/space/panePlace). 숨기기 = 비추기만 떼기 — 크롬·세션은 그대로(끄는 건 참모·세션)
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { tabStrip, type Live } from '../../domain/agentBrowser';
import { keyEvents, keyTarget, type InputEv } from '../../domain/agentInput';
import { closeWay, deskOffer, paneMenuKeys, paneStatus, signedLine, turnCard, turnCardAfterDone, type PaneMenuKey } from '../../domain/browserDock';
import { IS_WIN } from '../../domain/reader';
import { handBack, takeOver } from '../AgentBrowserModal';
import { askPermission, readConfig } from '../../data/tauri';
import { tr } from '../../i18n';
import { useAgentTabs } from '../AgentBrowser';
import { IconBack, IconClose, IconForward, IconMore, IconRefresh } from '../Icons';
import { IconButton } from '../kit/IconButton';
import type { MenuItem } from '../OrchDialogs';
import { usePanePlace } from './panePlace';
import { addressTarget, shownAddress } from '../../domain/address';
import { enterAction } from '../../domain/enterSend';
import { useTypeField } from '../typeField';
import '../agentBrowser.css';
import './browserPane.css';

type Menu = (e: React.MouseEvent, items: MenuItem[]) => void;

/** 비추기 칸 안내 — 그림이 오는 중엔 없음 */
export function paneNote(answer: string): { text: string; settings: boolean } | null {
  switch (answer) {
    case 'live': return null;
    case 'no-permission': return { text: tr('화면 기록 권한이 한 번 필요해 — 이 브라우저 창 하나만 찍는다. 허용한 뒤 Chammo 를 다시 켜야 해(맥 규칙).', 'Screen Recording permission is needed once — only this browser window is captured. Restart Chammo after allowing it (a macOS rule).'), settings: true };
    case 'no-window': return { text: tr('브라우저 창을 못 찾았어 — 세션이 다시 쓰면 이어져', 'Could not find the browser window — it resumes when the session uses it again'), settings: false };
    case 'stopped': return { text: tr('브라우저 화면이 멈췄어 — 다시 붙는 중', 'The browser screen stopped — reconnecting'), settings: false };
    default: return { text: tr('브라우저 화면 받는 중…', 'Connecting to the browser…'), settings: false };
  }
}

export function BrowserPane({ live, name, onHide, onClosed, openMenu }: { live: Live; name: string; onHide: () => void; onClosed?: (profile: string, pid: number) => void; openMenu?: Menu }) {
  const stage = useRef<HTMLDivElement>(null);
  const profile = live.profile;
  const api = useMemo(() => ({
    place: (rect: unknown, vh: number, visible: boolean) => invoke<string>('browser_pane_place', { profile, rect, vh, visible }),
    still: () => invoke<string>('browser_pane_still', { profile }),
    detach: () => void invoke('browser_pane_detach', { profile }).catch(() => {}),
  }), [profile]);
  // 0.5초마다 다시 알린다 — 그때 Rust 가 재 둔 지금 탭 창 모양(크기 맞춤·팝업 창으로 넘어감)을 비추기가 받는다
  const { answer, still } = usePanePlace(true, stage, api, profile, 500);
  const t = useAgentTabs(profile, 1000);
  const tabs = tabStrip(t.pages, t.current, t.dialogTabs);
  const pick = (id: string) => void invoke('agent_pin', { profile, target: t.pinned && id === t.current ? null : id }).catch(() => {});
  const note = paneNote(answer);
  // 사람 입력(시안 A — 평소에도 바로 만짐): 마우스·휠은 비추기 뷰(Swift)가 바로 넘기고, 키·한글·붙여넣기는 이 숨은 글칸이 받는다(모달과 같은 길).
  // 개입이 아니면 첫 누름·키에 Rust 가 저절로 개입을 켠다(browser_pane::pane_step). 친 글은 보내자마자 비우고 어디에도 안 남긴다
  const field = useRef<HTMLTextAreaElement>(null);
  const addr = useRef<HTMLInputElement>(null);
  const send = (events: InputEv[]) => void invoke('browser_pane_input', { profile, events }).catch(() => {});
  // 글은 글칸 값의 차이만(조합 중 글자는 페이지에 미리, 조합 끝 Enter 는 마지막 글자 뒤) — 10-28 사용자 '유튜브브'
  const typing = useTypeField(field, send);
  const hide = useRef(onHide);
  hide.current = onHide;
  useEffect(() => {
    const w = window as unknown as { __bpFocus?: (p: string) => void };
    w.__bpFocus = (p) => { if (p !== profile) return; typing.clicked(); field.current?.focus({ preventScroll: true }); };
    const stop = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); };
    const on = (e: KeyboardEvent) => {
      if (document.activeElement !== field.current) return;
      const r = keyTarget(e, true);
      if (r === 'app') return;
      if (r === 'close') { stop(e); hide.current(); return; } // ⌘W = 칸 숨기기(브라우저는 그대로)
      if (r === 'none') { stop(e); if (e.metaKey && e.code === 'KeyL') addr.current?.focus(); return; } // ⌘L = 주소창(크롬처럼)
      const pre = typing.pre(e);
      if (pre === 'done') return;
      if (pre === 'stop') { stop(e); return; }
      const k = keyEvents(e);
      if (k) { stop(e); typing.key(k); }
    };
    window.addEventListener('keydown', on, true);
    return () => { window.removeEventListener('keydown', on, true); if (w.__bpFocus) delete w.__bpFocus; };
  }, [profile, typing]);
  const url = t.pages.find((p) => p.id === t.current)?.url ?? live.url;
  // 주소창 — 고치는 동안만 내 글(edit), 아니면 지금 탭 주소. Enter = 주소면 그리로, 아니면 기본 검색(설정). 사람이 이동 = 개입(Rust pane_step)
  const [edit, setEdit] = useState<string | null>(null);
  const [engine, setEngine] = useState('');
  useEffect(() => { void readConfig().then((c) => setEngine(c.searchEngine ?? ''), () => {}); }, []);
  const go = (el: HTMLInputElement) => {
    const to = addressTarget(el.value, engine);
    if (to) send([{ kind: 'go', url: to }]);
    el.blur();
  };
  // 아래 줄(2026-10-28) — 차례 표시는 띠 하나. 사람이 쥐었으면(칸을 눌러 저절로 켜진 개입 포함) 돌려주기가 늘 보인다
  const stat = paneStatus(live);
  // 사람 차례 카드(시안 A) — 칸 아래 작은 카드, 모달 없이. 비추기 층 밖(칸과 머리 줄 사이)이라 덮개 문제가 없다
  // '다 했어'를 누른 부름 — 래퍼가 치울 때까지 카드를 미리 걷는다(실패하면 되살림)
  const [sentAt, setSentAt] = useState<number | null>(null);
  // 윈도우 숨은 데스크톱(win_desk) — 크롬 창은 못 옮겨서 '꺼내기' = 같은 프로필을 보이는 창으로 다시 띄우기
  const win = IS_WIN ? { desk: !!t.desk, shown: t.shown } : undefined;
  // 맥 패스키 탈출구 — ad-hoc 사본(Dock 숨김·선명한 칸)엔 맥 패스키가 없다. 같은 프로필을 구글 서명 크롬으로 다시 띄웠다 돌아온다(agent_signed).
  // auto = 래퍼가 페이지의 패스키 부름을 보고 스스로 바꿨다(2026-10-29) — 칸에 까닭 한 줄과 돌아오기
  const mac = IS_WIN ? undefined : { signable: !!t.signable, signed: !!t.signed, auto: !!t.signedAuto };
  const card = turnCardAfterDone(turnCard(live, { dialog: t.dialog, chooser: t.chooser }, mac), live.ask?.at, sentAt);
  const signedNow = signedLine(mac);
  const signed = (on: boolean) => void (on ? mine() : Promise.resolve()).then(() => invoke('agent_signed', { profile, on })).catch(() => {});
  const [say, setSay] = useState('');
  const [prompt, setPrompt] = useState('');
  useEffect(() => { setSay(''); setPrompt(''); }, [card?.kind, card?.text]);
  // 사람 손이 아니면(세션이 부른 것도 아니면) 개입부터 — Rust 가 사람 조작만 받는다
  const mine = () => (live.takeover || live.ask ? Promise.resolve() : takeOver(profile, live.pid));
  // 다 했어 = 돌려주기 겸함 — 부름이 그새 바뀌어 못 끝내도 쥔 개입은 돌려준다(안 눌린 것처럼 보이지 않게)
  const done = () => {
    const at = live.ask?.at ?? null;
    if (at != null && at === sentAt) return; // 한 번만 — 같은 부름을 여러 번 보내지 않는다
    setSentAt(at);
    void invoke('agent_ask_done', { profile, pid: live.pid, at, say: say.trim() || null })
      .catch(() => { setSentAt(null); return live.takeover ? handBack(profile, live.pid) : undefined; }).catch(() => {});
  };
  const give = () => void handBack(profile, live.pid).catch(() => {});
  const reply = (accept: boolean) => void mine().then(() => invoke('agent_dialog', { profile, pid: live.pid, target: t.current, accept, prompt: card?.kind === 'dialog' && card.prompt ? prompt : null })).catch(() => {});
  // 브라우저 끄기 — 크롬만 닫는다(세션은 그대로, 다음 브라우저 도구가 새로 띄운다). 끄면 칸은 바로 닫힌다(SpaceView 가 직전 탭으로)
  const [asking, setAsking] = useState(false);
  const closeNow = () => { setAsking(false); void invoke('agent_close_browser', { profile }).then(() => onClosed?.(profile, live.pid), () => {}); };
  // 탭 닫기는 사람 조작 — 개입부터(세션 도구는 래퍼가 붙잡았다가 돌려주면 이어 간다). 마지막 탭 X = 브라우저 끄기(크롬처럼, 10-28 사용자)
  const closeTab = (id: string) => {
    const way = closeWay(live, t.pages.length);
    if (way === 'confirm') { setAsking(true); return; }
    if (way === 'close') { closeNow(); return; }
    void mine().then(() => invoke('agent_close_tab', { profile, pid: live.pid, target: id })).catch(() => {});
  };
  const showChrome = () => void mine().then(() => invoke('agent_focus', { profile })).then(() => t.setShown(true), () => {});
  // 파일 고르기 — 사람이 칸에서 파일 칸을 누르면 숨긴 크롬 창 대신 앱 창에 붙는 시트(모달과 같은 길)
  const choosing = useRef(false);
  useEffect(() => {
    if (!t.chooser || choosing.current) return;
    choosing.current = true;
    void invoke('agent_choose_files', { profile, pid: live.pid }).catch(() => {}).finally(() => { choosing.current = false; });
  }, [t.chooser]); // eslint-disable-line react-hooks/exhaustive-deps
  const more = (e: React.MouseEvent) => {
    const items: Record<PaneMenuKey, MenuItem> = {
      chrome: { label: win ? tr('보이는 창으로 열기', 'Open in a visible window') : tr('크롬에서 보기', 'Show in Chrome'), run: () => void invoke('agent_focus', { profile }).then(() => t.setShown(true), () => {}) },
      desk: { label: tr('숨은 화면에서 도는 중 — 작업 표시줄에 안 보여', 'Running on a hidden desktop — not in the taskbar'), title: tr('패스키·Windows Hello 처럼 창이 필요하면 보이는 창으로 열어', 'Open it in a visible window when a passkey or Windows Hello prompt is needed') },
      unshow: { label: tr('숨은 화면으로 돌려놓기', 'Move back to the hidden desktop'), run: () => void invoke('agent_hide', { profile }).then(() => t.setShown(false), () => {}) },
      signed: { label: tr('이번만 구글 크롬으로 열기', 'Open in Google Chrome this once'), title: tr('패스키 로그인이 막힐 때 — 그동안 독에 보이고 칸이 조금 흐려', 'When a passkey sign-in is blocked — it shows in the Dock and the pane is a little blurry meanwhile'), run: () => signed(true) },
      unsigned: { label: tr('참모 브라우저로 돌아가기', 'Back to the Chammo browser'), run: () => signed(false) },
      headless: { label: tr('창 없이 도는 중 — 맥 독에 안 보여', 'Running without a window — not in the Dock'), title: tr('이 맥엔 가짜 화면이 없어 화면 없는 크롬으로 돌아', 'This Mac has no virtual display, so Chrome runs headless') },
      copy: { label: tr('주소 복사', 'Copy address'), run: () => void navigator.clipboard?.writeText(url).catch(() => {}) },
      // 끄는 건 보통 참모·세션 몫 — 사람용은 맨 안쪽 하나(시안 A). 세션은 그대로, 다음에 브라우저를 쓰면 새로 뜬다
      close: { label: live.sessionPid > 0 ? tr('브라우저 끄기 — 세션이 다시 쓰면 새로 떠', 'Close the browser — it reopens when the session uses it') : tr('브라우저 끄기', 'Close the browser'), danger: true, sep: true, run: closeNow },
    };
    openMenu?.(e, paneMenuKeys(!!t.headless, !!url, win, mac).map((k) => items[k]));
  };
  return (
    <div className="bp" data-profile={profile}>
      <div className="bp-bar">
        <IconButton size="s" label={tr('뒤로', 'Back')} onClick={() => send([{ kind: 'nav', action: 'back' }])}><IconBack /></IconButton>
        <IconButton size="s" label={tr('앞으로', 'Forward')} onClick={() => send([{ kind: 'nav', action: 'forward' }])}><IconForward /></IconButton>
        <IconButton size="s" label={tr('새로고침', 'Reload')} onClick={() => send([{ kind: 'nav', action: 'reload' }])}><IconRefresh /></IconButton>
        <input ref={addr} className="bp-addr" value={edit ?? shownAddress(url)} aria-label={tr('주소', 'Address')} placeholder={tr('주소 또는 검색어', 'Address or search')} spellCheck={false} autoCorrect="off" autoCapitalize="off"
          onFocus={(e) => { const el = e.currentTarget; setEdit(shownAddress(url)); requestAnimationFrame(() => el.select()); }}
          onChange={(e) => setEdit(e.target.value)} onBlur={() => setEdit(null)}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            if (e.key === 'Escape') { e.preventDefault(); el.blur(); return; }
            // 한글을 치다 Enter — WebKit 은 조합을 끝내는 Enter 를 229 로 준다(domain/enterSend). 글이 다 들어간 뒤에 간다
            const a = enterAction({ key: e.key, keyCode: e.keyCode, isComposing: e.nativeEvent.isComposing, shiftKey: e.shiftKey });
            if (a === 'skip') return;
            e.preventDefault();
            if (a === 'defer') setTimeout(() => go(el), 0); else go(el);
          }} />
        <div className="bp-tabs" role="tablist" aria-label={tr(`${name} 브라우저 탭`, `${name} browser tabs`)}>
          {tabs.map((x) => (
            <span key={x.id} className={`bp-chip ${x.active ? 'on' : ''}`}>
              <button role="tab" aria-selected={x.active} className={`bp-tab ${x.active ? 'on' : ''} ${x.dialog ? 'dlg' : ''}`} onClick={() => pick(x.id)} title={x.url}>
                <span>{x.label}</span>
              </button>
              {/* 브라우저의 X = 그 탭 닫기(10-28 사용자). 칸 숨기기는 스페이스 탭 줄의 X 만 */}
              <IconButton size="s" className="bp-tab-x" label={tr(`${x.label} 탭 닫기`, `Close the ${x.label} tab`)} onClick={() => closeTab(x.id)}><IconClose /></IconButton>
            </span>
          ))}
        </div>
        {t.pinned && <button className="bp-follow" onClick={() => void invoke('agent_pin', { profile, target: null }).catch(() => {})}>{tr('따라가기', 'Follow')}</button>}
        {openMenu && <IconButton size="s" label={tr('더보기', 'More')} onClick={more}><IconMore /></IconButton>}
      </div>
      <div className="bp-screen" ref={stage}>
        {still && <img className="bp-still" src={still} alt="" />}
        <textarea ref={field} className="abm-field bp-field" aria-label={tr(`${name} 브라우저에 입력`, `Type into the ${name} browser`)} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          {...typing.props} />
        {note && (
          <div className="bp-note" role="status">
            <span>{note.text}</span>
            {note.settings && <button className="cv-btn" onClick={() => void askPermission('screen')}>{tr('권한 열기', 'Open settings')}</button>}
          </div>
        )}
      </div>
      {asking && (
        <div className="bp-turn" role="alertdialog" aria-label={tr('브라우저 끄기', 'Close the browser')}>
          <i className="bp-turn-dot" aria-hidden="true" />
          <span className="bp-turn-text">{tr(`${name} 세션이 쓰는 중이야 — 끌까?`, `${name} is using this browser — close it?`)}</span>
          <button className="cv-btn" onClick={() => setAsking(false)}>{tr('취소', 'Cancel')}</button>
          <button className="cv-btn danger" onClick={closeNow}>{tr('끄기', 'Close')}</button>
        </div>
      )}
      {card && (
        <div className="bp-turn" role="alert">
          <i className="bp-turn-dot" aria-hidden="true" />
          <span className="bp-turn-text"><b>{tr('네 차례', 'Your turn')}</b> {card.text}</span>
          {card.kind === 'dialog' && card.prompt && <input className="bp-turn-in" value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label={tr('페이지가 묻는 값', 'Value the page asks for')} />}
          {card.kind === 'dialog' && <><button className="cv-btn" onClick={() => reply(false)}>{tr('취소', 'Cancel')}</button><button className="cv-btn solid" onClick={() => reply(true)}>{tr('확인', 'OK')}</button></>}
          {card.kind === 'ask' && <>
            <input className="bp-turn-in" value={say} onChange={(e) => setSay(e.target.value)} placeholder={tr('세션에 한마디', 'A note for the session')} aria-label={tr('세션에 한마디', 'A note for the session')}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); done(); } }} />
            {deskOffer(card, win) && <button className="cv-btn" onClick={showChrome} title={tr('패스키·Windows Hello·파일 창처럼 창이 필요할 때', 'When a passkey, Windows Hello or file window is needed')}>{tr('보이는 창에서 열기', 'Open in a visible window')}</button>}
            <button className="cv-btn solid" onClick={done} title={tr('세션에 돌려주기', 'Hand back to the session')}>{tr('다 했어', 'Done')}</button>
          </>}
          {(card.kind === 'passkey' || card.kind === 'window') && <button className="cv-btn solid" onClick={showChrome}>{tr('크롬 창 꺼내기', 'Open Chrome window')}</button>}
        </div>
      )}
      {signedNow && (
        <div className="bp-stat bp-signed" role="status">
          <span className="bp-doing">{signedNow}</span>
          <button className="cv-btn" onClick={() => signed(false)} title={tr('참모 브라우저로 다시 열기', 'Reopen in the Chammo browser')}>{tr('돌아오기', 'Go back')}</button>
        </div>
      )}
      {(stat.text || stat.giveBack) && (
        <div className={`bp-stat ${stat.giveBack ? 'mine' : ''}`}>
          {live.busy && !stat.giveBack && <span className="cv-spin" aria-hidden="true" />}
          <span className="bp-doing">{stat.text}</span>
          {stat.giveBack && <button className="cv-btn solid" onClick={give}>{tr('세션에 돌려주기', 'Hand back to the session')}</button>}
        </div>
      )}
    </div>
  );
}

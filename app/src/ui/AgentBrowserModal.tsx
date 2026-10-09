import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ASK_EMPTY, askClose, askOpen, askShown, askStep, askWaiting, type AskState } from '../domain/agentAsk';
import { controlOf, currentSite, permLine, stuckLine, tabStrip, takeoverLine, type Live } from '../domain/agentBrowser';
import { approach, escCancelsDialog, escClose, keyEvents, keyTarget, menuRoute, modsOf, pointIn, unfocusedKey, type InputEv } from '../domain/agentInput';
import { tr } from '../i18n';
import { FrameView, useAgentFrame, useAgentTabs, useBrowserScreen } from './AgentBrowser';
import { AGENT_DROP_EVENT } from './fileDrop';
import { IconClose, IconMore } from './Icons';

const OPEN_EVENT = 'agent-browser-open';
/** 그 세션 브라우저를 크게 보기(앱 맨 위 AgentAskHost 가 띄운다) */
export const openAgentModal = (profile: string) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: profile }));

const CLOSE_EVENT = 'agent-browser-close';
/** 마지막으로 브라우저가 키를 가져간 때 — 같은 누름이 메뉴바로 늦게 와도(⌘W 로 모달이 닫힌 뒤) 앱이 세션을 끄지 않게 */
let keyAt = 0;
/** 모달이 떠 있다 — 글칸 포커스가 없어도 메뉴바 ⌘W 는 모달 닫기(앱이 뒤 세션을 끄지 않게) */
let modalUp = false;
/** 모달 글칸에 포커스 = 키는 브라우저 몫 */
const owns = () => !!(document.activeElement as HTMLElement | null)?.classList.contains('abm-field');
/** App 전역 키 처리기가 먼저 본다 — 브라우저 몫이면 손대지 않고 모달에 넘긴다 */
export const browserOwnsKey = (e: KeyboardEvent) => owns() && keyTarget(e, true) !== 'app';
/** App 메뉴바 처리기가 먼저 본다 — true 면 앱은 안 한다(⌘W 는 모달 닫기, 나머지는 키 쪽이 이미 브라우저로 보냈다) */
export function browserMenu(id: string): boolean {
  if (!owns() && !modalUp && Date.now() - keyAt > 600) return false;
  const r = menuRoute(id);
  if (r === 'close') window.dispatchEvent(new Event(CLOSE_EVENT));
  return r !== 'app';
}

/** 사람이 친 순간 머리에 보던 탭·주소 — Rust 일꾼이 보내기 직전에 지금 입력 대상과 맞춰 보고 다르면 버린다 */
type Expect = { target: string; url: string } | null;
// pid = 모달이 보는 래퍼 — Rust 가 지금 그 프로필의 래퍼가 이것일 때만 넣는다(다른 세션 브라우저가 같은 프로필을 잡았으면 버림)
const send = (profile: string, pid: number, expect: Expect, events: InputEv[]) => void invoke('agent_input', { profile, pid, expect, events }).catch(() => {});
/** 막힌 화면(닫힘·못 받음)·보기만(개입 전)엔 안 보낸다 — Rust 도 개입·부름이 아니면 버린다(agent_browser human_ok) */
const sendIf = (blocked: { current: boolean }, profile: string, pid: number, expect: Expect, events: InputEv[]) => { if (!blocked.current) send(profile, pid, expect, events); };
/** 사람 개입 시작·돌려주기(2026-10-06 사용자) — 래퍼가 그동안 세션 도구를 붙잡고, 돌려주면 사람이 한 일 꼬리표를 준다 */
/** 막 개입한 브라우저 — 칸의 '개입'으로 열린 모달이 목록(1.5초)을 기다리지 않고 바로 조작되게 */
const took = new Map<string, number>();
export const takeOver = (profile: string, pid: number) => invoke('agent_takeover', { profile, pid, by: 'desktop' }).then(() => { took.set(`${profile}:${pid}`, Date.now()); });
export const handBack = (profile: string, pid: number) => invoke('agent_handback', { profile, pid });

/**
 * 세션 브라우저 '크게 보기'(2026-10-03 사용자 "이게 크게 보여야 해. 이미지 모달로 볼 때처럼") — 앱 창 전체 위, Esc·바깥·× 로 닫기.
 * 화면을 눌러 직접 조작: 마우스·휠·키는 CDP Input 으로 그 크롬에(창은 계속 가상 모니터에 숨긴 채), 글자는 숨은 글칸이 받아
 * 조합이 끝난 한글·영문·붙여넣기를 insertText 로. 친 글·비밀번호는 어디에도 안 남긴다(상태·로그·기록 없음).
 * 세션이 사람을 부르면(browser_ask_human) 맨 위에 이유와 '다 했어'. 페이지가 띄운 JS 대화상자는 여기서 고른다.
 * 맨 위 줄 = 어느 세션 · 진짜 주소(크롬이 아는 지금 탭 주소 — 입력이 가는 탭, 페이지가 못 바꾼다) · 줄 선 다른 부름(눌러야 바뀐다)
 */
export function AgentBrowserModal({ live, gone, name, focus, waiting, onSwitch, onClose }: {
  live: Live;
  /** 목록에서 빠진 브라우저를 붙든 채(크롬 꺼짐) — 마지막 화면은 흐리게 + '닫혔어', 입력·'다 했어'는 막는다 */
  gone: boolean;
  /** 어느 세션 브라우저인지(프로젝트 · 세션 이름) */
  name: string;
  /** 사람이 눌러 열었으면 글칸에 바로 포커스 — 저절로 뜬 모달은 화면을 눌러야(치던 다른 글이 브라우저로 안 가게) */
  focus: boolean;
  /** 이 모달 말고 사람을 기다리는 다른 세션 브라우저들 */
  waiting: { live: Live; name: string }[];
  onSwitch: (l: Live) => void;
  onClose: () => void;
}) {
  const { src } = useAgentFrame(live.profile, 66); // 크게 보는 동안 ~15fps
  const tabsNow = useAgentTabs(live.profile, 400); // 주소가 바뀌면 머리 도메인이 빨리 따라오게
  const { pages, current, pinned, shown, setShown, dialog, dialogTabs, stuck, chooser, dropped, error, popup, wrapperDialog, permission } = tabsNow;
  // 화면이 진짜인가 — 아니면(닫힘·못 받음·오래 주소 모름) 입력을 막는다. 보내 봐야 Rust 가 버린다(예전엔 사진 위를 눌러도 아무 일이 없었다)
  const scr = useBrowserScreen(tabsNow, gone);
  // 평소엔 보기만 — 개입(mine)·세션이 부름(ask) 동안만 화면 조작. 누르면 목록(1.5초)을 기다리지 않고 바로 바뀐 것으로 본다(want)
  const [want, setWant] = useState<boolean | null>(() => (Date.now() - (took.get(`${live.profile}:${live.pid}`) ?? 0) < 5000 ? true : null));
  const liveMine = !!live.takeover;
  useEffect(() => { if (want !== null && want === liveMine) setWant(null); }, [liveMine, want]);
  const ctl = controlOf({ ...live, takeover: (want ?? liveMine) ? live.takeover ?? { by: 'desktop', at: Date.now() } : null });
  const canCtl = ctl !== 'view' && !gone;
  const blocked = useRef(false);
  blocked.current = scr.blocked || !canCtl;
  const curUrl = pages.find((p) => p.id === current)?.url;
  const expect = useRef<Expect>(null);
  expect.current = current && curUrl != null ? { target: current, url: curUrl } : null;
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState('');
  const screen = useRef<HTMLDivElement>(null);
  const prof = useRef(live.profile);
  prof.current = live.profile;
  const pid = live.pid; // 모달은 브라우저(프로필:래퍼)마다 새로 그린다(AgentAskHost key) — 한 모달 안에선 안 바뀐다
  const img = useRef<HTMLImageElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const lastMove = useRef(0);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // 지금 탭 대화상자에 답 — 그 대화상자가 뜬 탭(current)으로 묶어 보낸다(다른 탭 대화상자로 안 가게)
  // 대화상자 답도 브라우저를 건드리는 것 — 보기만이었으면 개입부터
  const answer = (accept: boolean) => {
    const go = () => invoke('agent_dialog', { profile: live.profile, pid, target: current, accept, prompt: accept && prompt != null ? prompt : null });
    void (canCtl ? go() : takeOver(live.profile, pid).then(() => { setWant(true); return go(); })).catch(() => {});
  };
  // 멈춘 탭(앱이 붙기 전에 뜬 대화상자) — 앱은 못 답하니 처음부터 붙은 래퍼 playwright 에 부탁한다(세션 도구를 붙잡는 래퍼만, gate)
  const [askedAt, setAskedAt] = useState<number | null>(null);
  useEffect(() => { if (!stuck) setAskedAt(null); }, [stuck]);
  const answerStuck = (accept: boolean) => {
    const at = Date.now() - 1000; // 래퍼 시계와 어긋남 여유
    const go = () => invoke('agent_dialog_wrapper', { profile: live.profile, pid, accept }).then(() => setAskedAt(at));
    void (canCtl ? go() : takeOver(live.profile, pid).then(() => { setWant(true); return go(); })).catch(() => {});
  };
  // 사이트가 물은 위치·알림 권한 — 사람 조작이라 보기만이었으면 개입부터
  const answerPerm = (allow: boolean) => {
    const go = () => invoke('agent_permission', { profile: live.profile, pid, target: current, allow });
    void (canCtl ? go() : takeOver(live.profile, pid).then(() => { setWant(true); return go(); })).catch(() => {});
  };
  const dialogKey = useRef<((accept: boolean) => void) | null>(null);
  dialogKey.current = dialog ? answer : null;

  // 사람이 눌러 열었으면 글칸에. 저절로 뜬 모달은 글칸 말고 모달 자체에 — 뒤 터미널·채팅에 포커스가 남으면 화면 속 칸에 친 줄 알았던
  // 비밀번호가 보이지 않는 뒤 칸으로 갔다(리뷰). 화면을 누르면 그때 글칸으로
  // 보기만일 땐 글칸에 안 둔다 — 키가 브라우저로 안 가고 Esc·⌘W 는 모달 닫기
  useEffect(() => {
    if (focus && canCtl) field.current?.focus();
    else { (document.activeElement as HTMLElement | null)?.blur(); box.current?.focus(); }
  }, [focus, canCtl]);
  useEffect(() => { modalUp = true; return () => { modalUp = false; }; }, []);
  // 탭·주소가 바뀌어 Rust 가 버린 입력이 생기면 알린다(처음 본 수는 기준만)
  const seenDrop = useRef<number | null>(null);
  useEffect(() => {
    if (seenDrop.current != null && dropped > seenDrop.current) setNote(tr('주소를 확인 못 해서(바뀌는 중) 방금 친 건 안 보냈어 — 위 주소 보고 다시', 'Could not confirm the address (it was changing), so that input was not sent — check it and retry'));
    seenDrop.current = dropped;
  }, [dropped]);
  // 키 — 글칸에 포커스면 브라우저 몫(keyTarget): ⌘ 조합·특수 키는 CDP 로, 글자·⌘V 는 글칸(input·paste)이. 창 전체에서 먼저 잡는다
  // (App 전역 처리기는 browserOwnsKey 로 비켜 준다). Esc 는 한 번은 페이지로, 0.5초 안 두 번이면 닫기. ⌘W 는 닫기
  useEffect(() => {
    let escAt = 0;
    const stop = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); };
    const on = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      // 페이지 대화상자가 떠 있으면 Esc 는 그 대화상자 취소 — 모달을 닫으면 대화상자만 남아 페이지가 굳었다(QA N7·B6)
      if (escCancelsDialog(e, !!dialogKey.current)) { stop(e); keyAt = Date.now(); dialogKey.current?.(false); return; }
      if (!owns()) { if (unfocusedKey(e) === 'close') { stop(e); keyAt = Date.now(); close.current(); } return; } // 저절로 뜬 모달·대화상자 입력칸 — Esc·⌘W 는 모달 닫기
      const r = keyTarget(e, true);
      if (r === 'app') return;
      keyAt = Date.now();
      if (r === 'close') { stop(e); close.current(); return; }
      if (r === 'none') { stop(e); return; }
      if (e.key === 'Escape') {
        const now = Date.now();
        if (escClose(escAt, now)) { stop(e); close.current(); return; }
        escAt = now;
      }
      const k = keyEvents(e);
      if (k) { stop(e); sendIf(blocked, prof.current, pid, expect.current, k); }
    };
    const shut = () => close.current();
    window.addEventListener('keydown', on, true);
    window.addEventListener(CLOSE_EVENT, shut);
    return () => { window.removeEventListener('keydown', on, true); window.removeEventListener(CLOSE_EVENT, shut); };
  }, []);
  // 파일 고르기 — 페이지의 파일 칸을 누르면 숨긴 크롬 창 대신 맥 파일 창. 고른 경로는 Rust 가 크롬에만 넣는다
  const choosing = useRef(false);
  useEffect(() => {
    if (!chooser || choosing.current) return;
    choosing.current = true;
    void invoke('agent_choose_files', { profile: prof.current, pid })
      .catch(() => setNote(tr('파일 고르기는 더보기의 크롬에서 보기로 해 줘', 'Use “Show in Chrome” (more) to pick files')))
      .finally(() => { choosing.current = false; field.current?.focus(); });
  }, [chooser]);
  // 모달 위로 끌어다 놓은 파일 — 그 자리(파일 칸·올리기 칸)에 놓는다
  useEffect(() => {
    const el = screen.current;
    if (!el) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ paths: string[]; x: number; y: number }>).detail;
      const p = at({ clientX: d.x, clientY: d.y });
      if (p && d.paths.length && expect.current && !blocked.current) void invoke('agent_drop_files', { profile: prof.current, pid, expect: expect.current, paths: d.paths, x: p.x, y: p.y }).catch(() => {});
    };
    el.addEventListener(AGENT_DROP_EVENT, on);
    return () => el.removeEventListener(AGENT_DROP_EVENT, on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPrompt(dialog?.type === 'prompt' ? dialog.defaultPrompt ?? '' : null); }, [dialog?.message, dialog?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e: { clientX: number; clientY: number }) => {
    const el = img.current;
    if (!el) return null;
    return pointIn(e.clientX, e.clientY, el.getBoundingClientRect(), el.naturalWidth, el.naturalHeight);
  };
  const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', e: React.PointerEvent) => {
    const p = at(e);
    if (!p) return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    // 멀리서 바로 누르면 사이 이동을 끼운다(순간이동으로 안 보이게)
    const lead: InputEv[] = type === 'mousePressed' ? approach(lastPt.current, p).map((q) => ({ kind: 'mouse', type: 'mouseMoved', x: q.x, y: q.y, button: 'none', modifiers: 0 })) : [];
    lastPt.current = p;
    sendIf(blocked, live.profile, pid, expect.current, [...lead, { kind: 'mouse', type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : button, clickCount: type === 'mouseMoved' ? 0 : Math.max(1, e.detail || 1), modifiers: modsOf(e) }]);
  };
  const pick = (id: string) => void invoke('agent_pin', { profile: live.profile, target: pinned && id === current ? null : id }).catch(() => {});
  // at = 보던 부름 — 그새 새 부름이 왔으면 그건 안 끝낸다(래퍼가 .done 표를 맞춰 본다)
  const done = () => void invoke('agent_ask_done', { profile: live.profile, pid, at: live.ask?.at ?? null }).then(onClose, () => {});
  const tabs = tabStrip(pages, current, dialogTabs);
  // 진짜 크롬 창을 꺼내면 직접 만질 수 있다 — Rust 가 개입부터 켠다(agent_focus)
  const showChrome = () => void invoke('agent_focus', { profile: live.profile }).then(() => { setShown(true); if (ctl === 'view') setWant(true); }, () => {});
  const take = () => void takeOver(live.profile, pid).then(() => { setWant(true); field.current?.focus(); }, () => setNote(tr('개입을 못 켰어 — 브라우저가 바뀌었을 수 있어', 'Could not take over — the browser may have changed')));
  const give = () => void handBack(live.profile, pid).then(() => setWant(false), () => setWant(false));
  const ask = live.ask;
  const site = currentSite(pages, current);

  return createPortal(
    <div className="abm-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="abm" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr(`세션 브라우저 크게 보기 — ${name}`, `Session browser — ${name}`)}>
        <div className="abm-who">
          <b title={name}>{name}</b>
          {/* 주소가 바뀌면 key 가 바뀌어 한 번 반짝인다 — 치기 전에 사이트가 바뀐 걸 놓치지 않게.
              자물쇠는 안 그린다 — 인증서 오류 화면도 주소는 https 라 '안전'으로 잘못 보였다(리뷰). https 가 아니면만 표시 */}
          {scr.kind === 'closed' || scr.kind === 'fail'
            ? <span className="abm-site abm-insecure">{scr.why}</span>
            : site
            ? <span key={site.host} className={`abm-site ${site.secure ? '' : 'abm-insecure'}`} title={tr('크롬이 아는 지금 탭 주소 — 입력은 이 사이트로 간다', 'The address Chrome reports — what you type goes here')}>
                {site.host}{!site.secure && <em>{tr('안전하지 않음', 'Not secure')}</em>}
              </span>
            : <span className="abm-site abm-insecure">{scr.why || tr('주소 확인 중', 'Checking address')}</span>}
          {waiting.length > 0 && (
            <div className="abm-queue" aria-label={tr('사람을 기다리는 다른 세션', 'Other sessions waiting')}>
              {waiting.map((w) => <button key={`${w.live.profile}:${w.live.pid}`} onClick={() => onSwitch(w.live)} title={w.live.ask?.reason || ''}>{tr(`${w.name}도 불러요`, `${w.name} needs you too`)}</button>)}
            </div>
          )}
        </div>
        <div className="abm-bar">
          <div className="ab-tabs" role="tablist" aria-label={tr('브라우저 탭', 'Browser tabs')}>
            {tabs.map((t) => <button key={t.id} role="tab" aria-selected={t.active} className={`ab-tab ${t.active ? 'ab-on' : ''} ${t.dialog ? 'ab-dlg' : ''}`} onClick={() => pick(t.id)} title={t.dialog ? `${t.url} — ${tr('대화상자', 'Dialog')}` : t.url}>{t.label}</button>)}
          </div>
          {note && <span className="abm-note">{note}</span>}
          {/* 개입 — 낯선 동작이라 글자(전역 UI 규칙). 누르면 그때부터 화면을 조작하고 세션은 브라우저 일을 멈춘다 */}
          {ctl === 'view' && !gone && scr.kind !== 'closed' && <button className="abm-takeover" onClick={take} title={tr('직접 조작 — 그동안 세션은 브라우저 일을 멈춰요', 'Take control — the session pauses its browser work')}>{tr('개입', 'Take over')}</button>}
          {/* 진짜 크롬 창 꺼내기는 더보기 안에 — 기본은 여기서 다 한다(꺼낸 창을 닫으면 앱이 빈 탭을 다시 열어 둔다) */}
          <div className="abm-more">
            <button className="ab-ic" onClick={() => setMore((m) => !m)} aria-expanded={more} title={tr('더보기', 'More')} aria-label={tr('더보기', 'More')}><IconMore /></button>
            {more && (
              <div className="abm-menu" role="menu">
                {shown
                  ? <button role="menuitem" onClick={() => { setMore(false); void invoke('agent_hide', { profile: live.profile }).then(() => setShown(false), () => {}); }}>{tr('크롬 창 숨기기', 'Hide the Chrome window')}</button>
                  : <button role="menuitem" onClick={() => { setMore(false); showChrome(); }}>{tr('크롬에서 보기', 'Show in Chrome')}</button>}
              </div>
            )}
          </div>
          <button className="ab-ic" onClick={onClose} title={tr('닫기 (Esc 두 번·⌘W)', 'Close (Esc twice · ⌘W)')} aria-label={tr('닫기', 'Close')}><IconClose /></button>
        </div>
        {ask && (
          <div className="abm-ask">
            <span>{tr('세션이 불러요', 'The session needs you')} — {ask.reason}</span>
            {/* 크롬이 꺼져 목록에서 빠졌으면(앱은 바로, 래퍼는 몇 초 안에 알아채 세션에 '꺼졌어'를 준다) 다 했다고 해도 볼 화면이 없다 — 막아 보인다 */}
            <button className="abm-done" onClick={done} disabled={gone && scr.kind === 'closed'} title={gone && scr.kind === 'closed' ? tr('브라우저가 닫혀서 세션이 다시 열어야 해', 'The browser is closed — the session has to open it again') : undefined}>{tr('다 했어', 'Done')}</button>
          </div>
        )}
        {ctl === 'mine' && (
          <div className="abm-take" role="status">
            <span>{takeoverLine({ ...live, takeover: live.takeover ?? { by: 'desktop', at: Date.now() } })}</span>
            <button className="abm-give" onClick={give}>{tr('돌려주기', 'Hand back')}</button>
          </div>
        )}
        {/* 앱이 답할 수 없는 대화상자(앱이 붙기 전에 뜬 것·답을 크롬이 거절)에 막힌 페이지 — 진짜 크롬 창에서 풀게(QA B6) */}
        {/* 크롬 자체 창(패스키·Touch ID·폰 QR·USB 키)은 이 그림에 안 찍힌다 — 진짜 크롬 창을 꺼내면 같이 보인다(2026-10-06 슬랙 패스키) */}
        {popup && !shown && !stuck && (
          <div className="abm-stuck" role="status">
            <span>{tr('크롬이 여기 안 보이는 창을 띄웠어 (패스키 등)', 'Chrome opened a window this view can’t show (passkey etc.)')}</span>
            <button onClick={showChrome}>{tr('크롬에서 보기', 'Show in Chrome')}</button>
          </div>
        )}
        {permission && !shown && (
          <div className="abm-stuck" role="status">
            <span>{permLine(permission)}</span>
            <button onClick={() => answerPerm(false)}>{tr('거부', 'Block')}</button>
            <button onClick={() => answerPerm(true)}>{tr('허용', 'Allow')}</button>
          </div>
        )}
        {stuck && !shown && (
          <div className="abm-stuck" role="status">
            <span>{stuckLine(askedAt, wrapperDialog)}</span>
            {live.gate && askedAt == null && <button onClick={() => answerStuck(false)}>{tr('취소', 'Cancel')}</button>}
            {live.gate && askedAt == null && <button onClick={() => answerStuck(true)}>{tr('확인', 'OK')}</button>}
            <button onClick={showChrome}>{tr('크롬에서 보기', 'Show in Chrome')}</button>
          </div>
        )}
        <div className={`abm-screen ${scr.blocked ? 'abm-blocked' : ''}`} ref={screen}
          onPointerDown={(e) => { e.preventDefault(); if (blocked.current) return; field.current?.focus(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); mouse('mousePressed', e); }}
          onPointerUp={(e) => mouse('mouseReleased', e)}
          onPointerMove={(e) => { const t = performance.now(); if (t - lastMove.current < 30) return; lastMove.current = t; mouse('mouseMoved', e); }}
          onWheel={(e) => { const p = at(e); if (p) sendIf(blocked, live.profile, pid, expect.current, [{ kind: 'mouse', type: 'mouseWheel', x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: modsOf(e) }]); }}
          onContextMenu={(e) => e.preventDefault()}>
          <FrameView profile={live.profile} src={src} scr={scr} error={error} alt={live.title || live.url} imgRef={img} />
          {/* 숨은 글칸 — 글자를 받아 insertText 로. 값은 보내자마자 비운다(남기지 않는다) */}
          <textarea ref={field} className="abm-field" readOnly={scr.blocked || !canCtl} aria-label={tr('세션 브라우저에 입력', 'Type into the session browser')} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            onInput={(e) => {
              const t = e.currentTarget;
              if ((e.nativeEvent as InputEvent).isComposing) return;
              if (t.value) sendIf(blocked, live.profile, pid, expect.current, [{ kind: 'text', text: t.value }]);
              t.value = '';
            }}
            onCompositionEnd={(e) => { const v = e.data || e.currentTarget.value; if (v) sendIf(blocked, live.profile, pid, expect.current, [{ kind: 'text', text: v }]); e.currentTarget.value = ''; }}
            onPaste={(e) => { e.preventDefault(); const v = e.clipboardData.getData('text'); if (v) sendIf(blocked, live.profile, pid, expect.current, [{ kind: 'text', text: v }]); }} />
        </div>
        {dialog && (
          <div className="abm-dialog" role="alertdialog" aria-label={tr('페이지 대화상자', 'Page dialog')}>
            <p>{dialog.type === 'beforeunload' ? tr('이 페이지를 나갈까요?', 'Leave this page?') : dialog.message}</p>
            {prompt != null && <input value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label={tr('대화상자 입력', 'Dialog input')} />}
            <div className="abm-dialog-btns">
              {dialog.type !== 'alert' && <button onClick={() => answer(false)}>{tr('취소', 'Cancel')}</button>}
              <button className="on" onClick={() => answer(true)}>{tr('확인', 'OK')}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 세션이 사람을 부르면(browser_ask_human → 상태 파일 ask) 그 세션 브라우저를 크게 띄우고 알린다(창을 보고 있으면 앱 안만 — notify 'human').
 * 모달이 이미 열려 있으면 바꾸지 않고 줄에만(머리에 'OO도 불러요') — 바꾸는 건 사람이 눌러서, 닫으면 줄 선 다음 부름(domain/agentAsk).
 * 닫은 부름은 다시 안 띄운다(브라우저 칸의 '사람 필요'로 다시 연다). 앱 어디서든 뜨게 맨 위에 하나
 */
export function AgentAskHost({ lives, nameOf, notify }: { lives: Live[]; nameOf: (l: Live) => string; notify: (profile: string, reason: string) => void }) {
  // 상태는 ref 로 고쳐 쓴다 — 틱(askStep)과 클릭(askOpen·askClose)이 한 렌더 안에 겹쳐도 서로 덮지 않게, 알림은 한 번만
  const stRef = useRef<AskState>(ASK_EMPTY);
  const [st, setSt] = useState<AskState>(ASK_EMPTY);
  const update = (f: (s: AskState) => AskState) => { stRef.current = f(stRef.current); setSt(stRef.current); };
  const livesRef = useRef(lives);
  livesRef.current = lives;
  // 브라우저 칸의 '크게 보기'·'사람 필요' — 모달은 여기 하나만(칸마다 띄우면 같은 세션 칸이 둘일 때 겹쳤다, 2026-10-03 실측)
  useEffect(() => {
    const on = (e: Event) => {
      const l = livesRef.current.find((x) => x.profile === (e as CustomEvent<string>).detail);
      if (l) update((s) => askOpen(s, l));
    };
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  useEffect(() => {
    const r = askStep(stRef.current, lives);
    update(() => r.state);
    for (const l of r.notify) notify(l.profile, l.ask?.reason ?? '');
  }, [lives]); // eslint-disable-line react-hooks/exhaustive-deps
  // 목록에서 빠진 동안은 마지막 것을 붙든다 — 모달은 저절로 안 닫고 gone 으로 '닫혔어' 덮개를 그린다(입력은 막는다)
  const last = useRef<Live | undefined>(undefined);
  const { live, gone } = askShown(st, lives, last.current);
  if (live && !gone) last.current = live;
  if (!live || !st.open) return null;
  // key = 브라우저가 바뀌면 모달을 새로(글칸·대화상자 입력이 옛 브라우저 것과 안 섞이게)
  return <AgentBrowserModal key={`${live.profile}:${live.pid}`} live={live} gone={gone} name={nameOf(live)} focus={st.open.byHuman}
    waiting={askWaiting(st, lives).map((l) => ({ live: l, name: nameOf(l) }))}
    onSwitch={(l) => update((s) => askOpen(s, l))} onClose={() => update((s) => askClose(s, livesRef.current, live))} />;
}

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { browserBig, browserScreen, tabStrip, takeoverLine, unpackFrame, type CdpPage, type Live } from '../domain/agentBrowser';
import { tr } from '../i18n';
import { IconCollapse, IconExpand, IconHide, IconMaximize, IconRefresh } from './Icons';
import { handBack, openAgentModal, takeOver } from './AgentBrowserModal';
import './agentBrowser.css';

/** 지금 떠 있는 세션 브라우저들(참모 브라우저 래퍼 상태) — 1.5초마다 */
export function useAgentLives(): Live[] {
  const [lives, setLives] = useState<Live[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = () => void invoke<Live[]>('agent_lives').then((l) => { if (alive) setLives((p) => (JSON.stringify(p) === JSON.stringify(l) ? p : l)); }, () => {});
    tick();
    const id = window.setInterval(tick, 1500);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  return lives;
}

const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? tr(`${s}초 전`, `${s}s ago`) : tr(`${Math.round(s / 60)}분 전`, `${Math.round(s / 60)}m ago`); };

/**
 * 세션 브라우저 칸(2026-10-03 사용자) — 브라우저 일 중이면 화면을 크게 + 아래 작은 띠에 하는 일·터미널(children),
 * 조용해지면(QUIET_MS) 터미널이 다시 크게 + 위에 작은 브라우저 띠. children 은 늘 같은 자리라 바뀌어도 터미널이 다시 안 뜬다.
 * 화면은 Rust 가 CDP screencast 로 받고(agent_frame), 이 칸이 묻는 동안만 받는다
 */
/** 세션 브라우저 화면 — interval 마다 새 프레임을 묻는다(묻는 동안만 Rust 가 받는다). 0 이면 안 묻는다 */
export function useAgentFrame(profile: string, interval: number) {
  const [src, setSrc] = useState('');
  const [lastFrameAt, setLastFrameAt] = useState(0);
  const seq = useRef(0);
  const url = useRef('');
  useEffect(() => {
    if (!interval) return;
    let alive = true;
    let timer = 0;
    const pull = async () => {
      try {
        const buf = await invoke<ArrayBuffer>('agent_frame', { profile, since: seq.current });
        const f = unpackFrame(buf);
        if (alive && f && f.seq > seq.current) {
          seq.current = f.seq;
          const next = URL.createObjectURL(new Blob([f.jpeg as BlobPart], { type: 'image/jpeg' }));
          if (url.current) URL.revokeObjectURL(url.current);
          url.current = next;
          setSrc(next);
          setLastFrameAt(Date.now());
        }
      } catch { /* 브라우저가 닫히는 중 */ }
      if (alive) timer = window.setTimeout(() => void pull(), document.hidden ? 1000 : interval);
    };
    void pull();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [profile, interval]);
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);
  return { src, lastFrameAt };
}

/** 화면이 진짜인가(domain browserScreen) — 목록에서 빠진·탭 0개·지금 탭 모름이 얼마나 이어졌는지 세서 넘긴다. gone = 모달이 목록에서 빠진 브라우저를 붙든 채 */
export function useBrowserScreen(t: { error: string; attached: boolean; pages: CdpPage[]; current: string | null; now: number }, gone = false) {
  const since = useRef<{ gone: number | null; empty: number | null; unsure: number | null }>({ gone: null, empty: null, unsure: null });
  const s = since.current;
  const age = (k: 'gone' | 'empty' | 'unsure', on: boolean) => {
    if (!on) s[k] = null;
    else if (s[k] == null) s[k] = t.now;
    return s[k] == null ? 0 : t.now - s[k]!;
  };
  const empty = t.attached && t.pages.length === 0;
  // 지금 탭 모름은 오류·빠짐 동안엔 안 센다 — 다시 붙는 순간 유예 없이 '못 찾음'이 한 번 지나갔다(리뷰)
  return browserScreen({
    goneMs: age('gone', gone), error: t.error, attached: t.attached, pages: t.pages.length, emptyMs: age('empty', empty),
    current: !!t.current, unsureMs: age('unsure', !t.current && !t.error && !gone),
  });
}

/**
 * 화면 칸 — 진짜 화면이면 그림. 아니면(닫힘·못 받음·오래 주소 모름) 마지막 그림을 흐리게 + 그 위에 왜 아닌지·다시 시도.
 * 예전엔 그림이 한 번 오면 이유를 안 그려서, 닫힌 브라우저의 마지막 화면이 '사진'처럼 남아 눌러도 안 먹었다(2026-10-05 사용자 실사용).
 * 이유 없이 '화면 받는 중'에 멈춰 사람이 기다리기만 한 것도(2026-10-05 QA 5)
 */
export function FrameView({ profile, src, scr, error, alt, imgRef }: { profile: string; src: string; scr: ReturnType<typeof browserScreen>; error: string; alt: string; imgRef?: React.Ref<HTMLImageElement> }) {
  const msg = scr.kind === 'closed' ? tr('브라우저가 닫혔어요 — 세션이 다시 열면 이어져', 'The browser is closed — it resumes when the session opens it again')
    : scr.kind === 'fail' ? tr('화면을 못 받았어', 'Could not get the screen') : scr.why;
  return (
    <>
      {src && <img ref={imgRef} src={src} alt={alt} draggable={false} className={scr.blocked ? 'ab-stale' : undefined} />}
      {scr.blocked
        ? (
          <span className="ab-cover" role="status" title={error || undefined}><span className="ab-cover-box">
            {msg}
            {/* 모달 화면 칸은 누름을 잡아(포인터 캡처) 크롬으로 보낸다 — 여기서 끊어야 버튼이 눌린다 */}
            <button className="ab-ic" onPointerDown={(e) => e.stopPropagation()} onClick={() => void invoke('agent_retry', { profile }).catch(() => {})} title={tr('다시 시도', 'Retry')} aria-label={tr('다시 시도', 'Retry')}><IconRefresh /></button>
          </span></span>
        )
        : !src && <span className="ab-wait">{tr('화면 받는 중', 'Connecting')}</span>}
    </>
  );
}

export type AgentDialog = { type: string; message: string; defaultPrompt?: string };
/** 탭 띠·꺼내 둔 크롬·JS 대화상자 — 1초마다 */
export function useAgentTabs(profile: string, every = 1000) {
  // dialog = 지금 탭 대화상자, dialogTabs = 대화상자가 떠 있는 탭들, stuck = 지금 탭이 멈춤(답이 안 들어감·앱이 모르는 대화상자 — 크롬에서 보기로 푼다)
  // error = 화면 받기 실패 이유(Rust 일꾼) — 다시 붙으면 지워진다. attached = 일꾼이 붙어 탭 목록을 읽음(그런데 탭 0개면 닫힘)
  // popup = 크롬이 이 그림 밖에 자기 창을 띄움(패스키·Touch ID·폰 QR) — 크롬에서 보기로 꺼내야 보인다
  const [t, setT] = useState<{ pages: CdpPage[]; current: string | null; pinned: boolean; shown: boolean; dialog: AgentDialog | null; dialogTabs: string[]; stuck: boolean; chooser: string | null; reopened: boolean; dropped: number; error: string; attached: boolean; popup: boolean }>({ pages: [], current: null, pinned: false, shown: false, dialog: null, dialogTabs: [], stuck: false, chooser: null, reopened: false, dropped: 0, error: '', attached: false, popup: false });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    const tick = () => {
      setNow(Date.now());
      void invoke<typeof t>('agent_tabs', { profile }).then((x) => { if (alive) setT({ ...x, dialog: x.dialog ?? null, dialogTabs: x.dialogTabs ?? [], chooser: x.chooser ?? null, error: x.error ?? '', attached: !!x.attached, popup: !!x.popup }); }, () => {});
    };
    tick();
    const id = window.setInterval(tick, every);
    return () => { alive = false; window.clearInterval(id); };
  }, [profile, every]);
  const setShown = (shown: boolean) => setT((x) => ({ ...x, shown }));
  return { ...t, now, setShown };
}

/**
 * 세션 브라우저 칸(2026-10-03 사용자) — 브라우저 일 중이면 화면을 크게 + 아래 작은 띠에 하는 일·터미널(children),
 * 조용해지면(QUIET_MS) 터미널이 다시 크게 + 위에 작은 브라우저 띠. children 은 늘 같은 자리라 바뀌어도 터미널이 다시 안 뜬다.
 * 화면은 Rust 가 CDP screencast 로 받고(agent_frame), 이 칸이 묻는 동안만 받는다. '크게 보기'는 직접 조작 모달(AgentBrowserModal)
 */
export function AgentBrowser({ live, children, className = '' }: { live: Live; children?: React.ReactNode; className?: string }) {
  // 손으로 크게·작게 — 다음 도구 호출이 오면 다시 알아서
  const [manual, setManual] = useState<{ big: boolean; at: number } | null>(null);
  const tabsNow = useAgentTabs(live.profile);
  const { pages, current, pinned, shown, setShown, now, reopened, dialogTabs, stuck, error, popup } = tabsNow;
  const scr = useBrowserScreen(tabsNow);
  const [bigNow, setBigNow] = useState(true);
  const { src, lastFrameAt } = useAgentFrame(live.profile, bigNow ? 100 : 700); // 크게 10fps, 작게 띠 썸네일
  const autoBig = browserBig(live, lastFrameAt, now);
  const big = manual && manual.at === live.toolAt ? manual.big : autoBig;
  useEffect(() => setBigNow(big), [big]);

  const tabs = tabStrip(pages, current, dialogTabs);
  // 페이지가 대화상자에서 기다린다 — 칸엔 멈춘 그림만 보여 사람은 그냥 멈춘 줄 알았다(QA B6). 누르면 크게 보기에서 답한다
  const waitTag = dialogTabs.length ? tr('대화상자', 'Dialog') : stuck ? tr('멈춤', 'Stuck') : popup && !shown ? tr('크롬 창', 'Chrome window') : '';
  const pick = (id: string) => void invoke('agent_pin', { profile: live.profile, target: pinned && id === current ? null : id }).catch(() => {});
  const hide = () => void invoke('agent_hide', { profile: live.profile }).then(() => setShown(false), () => {});
  const flip = () => setManual({ big: !big, at: live.toolAt });
  // 사람 개입(2026-10-06 사용자) — 칸은 보기만, '개입'을 누르면 개입을 켜고 크게 보기에서 조작. 개입 중이면 칸에도 표시·돌려주기
  const take = () => void takeOver(live.profile, live.pid).then(() => openAgentModal(live.profile), () => {});
  const give = () => void handBack(live.profile, live.pid).catch(() => {});
  const taking = takeoverLine(live);
  const held = live.held ? tr('세션은 사람이 돌려주길 기다리는 중', 'The session is waiting for you to hand back') : '';
  const doing = taking || held || (reopened ? tr('꺼낸 크롬 창이 닫혀서 빈 탭을 다시 열어 뒀어 — 세션이 다시 쓰면 이어져', 'The Chrome window was closed — a blank tab is kept so the session can go on') : live.tool ? `${live.busy ? '' : `${ago(now - live.toolAt)} · `}${live.tool}` : '');

  return (
    <div className={`ab ${big ? 'ab-big' : 'ab-small'} ${className}`}>
      {big ? (
        <div className="ab-view">
          <div className="ab-bar">
            <div className="ab-tabs" role="tablist" aria-label={tr('브라우저 탭', 'Browser tabs')}>
              {tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={t.active} className={`ab-tab ${t.active ? 'ab-on' : ''} ${t.dialog ? 'ab-dlg' : ''}`} onClick={() => pick(t.id)} title={t.dialog ? `${t.url} — ${tr('대화상자', 'Dialog')}` : t.url}>{t.label}</button>
              ))}
            </div>
            {pinned && <button className="ab-follow" onClick={() => void invoke('agent_pin', { profile: live.profile, target: null })}>{tr('따라가기', 'Follow')}</button>}
            {/* 크롬에서 보기는 크게 보기 모달의 더보기 안에(2026-10-03 사용자) — 꺼내 둔 동안만 여기 숨기기 */}
            {shown && <button className="ab-ic" onClick={hide} title={tr('크롬 창 숨기기', 'Hide the Chrome window')} aria-label={tr('크롬 창 숨기기', 'Hide the Chrome window')}><IconHide /></button>}
            {live.ask && <button className="ab-ask" onClick={() => openAgentModal(live.profile)}>{tr('사람 필요', 'Needs you')}</button>}
            {!live.ask && scr.kind !== 'closed' && (live.takeover
              ? <button className="ab-follow" onClick={give} title={taking ?? undefined}>{tr('돌려주기', 'Hand back')}</button>
              : <button className="ab-follow" onClick={take} title={tr('직접 조작 — 그동안 세션은 브라우저 일을 멈춰요', 'Take control — the session pauses its browser work')}>{tr('개입', 'Take over')}</button>)}
            {!live.ask && waitTag && <button className="ab-ask" onClick={() => openAgentModal(live.profile)}>{waitTag}</button>}
            <button className="ab-ic" onClick={() => openAgentModal(live.profile)} title={tr('크게 보기 — 직접 조작', 'Open large — control it')} aria-label={tr('크게 보기', 'Open large')}><IconMaximize /></button>
            <button className="ab-ic" onClick={flip} title={tr('터미널 크게', 'Terminal larger')} aria-label={tr('터미널 크게', 'Terminal larger')}><IconCollapse /></button>
          </div>
          <div className="ab-screen"><FrameView profile={live.profile} src={src} scr={scr} error={error} alt={live.title || live.url} /></div>
          <div className={`ab-doing ${live.busy ? 'ab-busy' : ''} ${taking ? 'ab-taking' : ''}`}>{live.busy && !taking && <span className="cv-spin" />}<span>{doing}</span></div>
        </div>
      ) : (
        <button className="ab-strip" onClick={flip} title={tr('브라우저 크게', 'Browser larger')}>
          {src ? <img src={src} alt="" className={scr.blocked ? 'ab-stale' : undefined} /> : <span className="ab-thumb" />}
          <b>{live.title || live.url}</b>
          {/* 사람을 기다리는 동안 작게 접어도 보이게(QA B2) — 누르면 크게 보기가 아니라 띠가 펴진다, 여는 건 펴진 칸의 '사람 필요' */}
          {live.ask ? <em className="ab-ask-tag">{tr('사람 필요', 'Needs you')}</em> : live.takeover ? <em className="ab-take-tag">{tr('조작 중', 'You have control')}</em> : waitTag && <em className="ab-ask-tag">{waitTag}</em>}
          <span>{doing}</span>
          <span className="ab-ic" aria-hidden="true"><IconExpand /></span>
        </button>
      )}
      <div className="ab-below">{children}</div>
    </div>
  );
}

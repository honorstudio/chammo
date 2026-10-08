import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { cardLine, cardShow, dismiss, kindView, LINE_TTL, type DirectCard, type Dismissed } from '../../domain/directAsk';
import { josa, machine, tr } from '../../i18n';
import { openAgentModal } from '../AgentBrowserModal';
import { IconClose } from '../Icons';
import './directCard.css';

type Pick = { pick: 'yes' } | { pick: 'no' } | { pick: 'option'; option: number } | { pick: 'text'; text: string };

/** 그 세션이 무슨 일을 하는지 한 줄 — 세션이 쓴 설명, 없으면 프로젝트 */
const whatOf = (c: DirectCard, project?: string) => c.what || tr(`${project || c.cwd.split('/').pop() || c.from} 일을 하는 세션`, `Session working on ${project || c.from}`);
const hm24 = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const hhmm = (ts?: string) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * 직접 답하기 카드(2026-10-03, 시안 A '흐름 속 카드') — 누가(세션·한 줄 설명) / 무엇을(위험 말·금액) / 누르면 / 그냥 두면.
 * 누르면 앱이 그 세션 입력칸에 사람 말로 친다(Rust direct_answer — 진짜 클릭에서만 부른다). 직접 답은 접어 둔다
 */
export type DirectPick = Pick;
const desktopAnswer = (id: string, pick: Pick) => invoke<void>('direct_answer', { id, pick });

export function DirectCardView({ c, name, project, profile, compact, onOpen, onAnswer = desktopAnswer, place, onRespawn, onDismiss }: {
  c: DirectCard; name: string; project?: string; profile?: string; compact?: boolean; onOpen?: () => void;
  /** 폰은 폰 서버 길(/api/direct-answer) */ onAnswer?: (id: string, pick: Pick) => Promise<void>;
  /** 데스크톱: 이 카드가 실제로 화면에 보이면 기록에 '보임' 한 줄(어느 화면) — scripts/direct status 가 읽는다 */ place?: string;
  /** 주인 세션이 꺼진 카드 — 같은 번호로 다시 띄우기 / 닫기 */ onRespawn?: () => Promise<void>; onDismiss?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [free, setFree] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useShownMark(box, c.id, place);
  const k = kindView(c.kind);
  const answer = (e: React.MouseEvent, pick: Pick) => {
    if (!e.isTrusted || busy) return; // 사람 클릭만 — 스크립트가 만든 클릭은 무시
    setBusy(true);
    setErr('');
    void onAnswer(c.id, pick).then(() => setFree(null), (x) => setErr(x instanceof Error ? x.message : String(x))).finally(() => setBusy(false));
  };
  const badge = <span className={`dc-risk dc-${k.tone}`}>{c.amount ? `${k.word} ${c.amount}` : k.word}</span>;
  const who = <span className="dc-av" aria-hidden="true">{(name || '?').slice(0, 1)}</span>;

  if (compact) {
    return (
      <div className="dc-mini" ref={box}>{who}<div className="dc-t"><b>{name}</b> {badge}<div className="dc-muted">{c.state === 'gone' ? tr('세션이 꺼졌어요', 'Session ended') : c.q}</div></div><button className="dc-link" onClick={onOpen}>{tr('열기', 'Open')}</button></div>
    );
  }
  const danger = k.tone === 'danger';
  if (c.state === 'gone') {
    // 답 전에 주인 세션이 꺼졌다 — 숨기지 않고 무엇을 물었는지 + 다시 띄우기/닫기(2026-10-05 아이맥: 꺼짐으로 판단된 카드가 5분 뒤 조용히 사라졌다)
    const respawn = () => { if (!onRespawn || busy) return; setBusy(true); setErr(''); void onRespawn().catch((x) => setErr(x instanceof Error ? x.message : String(x))).finally(() => setBusy(false)); };
    return (
      <div className="dc-card dc-off" ref={box} role="group" aria-label={tr(`${josa(name, '이', '가')} 물은 카드 — 세션이 꺼짐`, `${name}'s card — session ended`)}>
        <div className="dc-top">
          <div className="dc-who">{who}<div><b>{name}</b><div className="dc-what">{whatOf(c, project)}</div></div></div>
          {onDismiss && <button className="dc-x" aria-label={tr('닫기', 'Dismiss')} title={tr('닫기', 'Dismiss')} onClick={onDismiss}><IconClose /></button>}
        </div>
        <div className="dc-q">{c.q}</div>
        <div className="dc-muted">{tr(`${hm24(c.ts)}에 물었는데 답하기 전에 세션이 꺼졌어요 — 다시 띄우면 이어서 답할 수 있어요`, `Asked at ${hm24(c.ts)}, but the session ended before an answer — restart it to answer`)}</div>
        {onRespawn && <div className="dc-acts"><button className="dc-btn dc-go" disabled={busy} onClick={respawn}>{tr('다시 띄우기', 'Restart session')}</button></div>}
        {err && <div className="dc-err" role="alert">{err}</div>}
      </div>
    );
  }
  return (
    <div ref={box} className={`dc-card ${danger ? 'dc-hot' : ''}`} role="group" aria-label={tr(`${josa(name, '이', '가')} 네 답을 기다려`, `${name} needs your answer`)}>
      <div className="dc-top">
        <div className="dc-who">{who}<div><b>{name}</b><div className="dc-what">{whatOf(c, project)}</div></div></div>
        <span className={`dc-risk dc-${k.tone}`}>{k.word}</span>
      </div>
      <div>
        {c.amount && <div className="dc-amount">{c.amount}</div>}
        <div className={c.amount ? 'dc-muted' : 'dc-q'}>{c.amount ? [c.q, c.detail].filter(Boolean).join(' · ') : c.q}</div>
        {!c.amount && c.detail && <div className="dc-muted">{c.detail}</div>}
      </div>
      {c.kind === 'login' ? (
        <dl className="dc-if"><dt>{tr('하는 법', 'How')}</dt><dd>{tr('크게 보기에서 직접 로그인하고, 끝나면 다 했어', 'Sign in yourself in the big view, then press Done')}</dd><dt>{tr('그냥 두면', 'If you wait')}</dt><dd>{tr('세션은 여기서 기다려요', 'The session waits here')}</dd></dl>
      ) : (
        <dl className="dc-if"><dt>{c.yes}</dt><dd>{tr('누르면 이 세션에 네 답으로 바로 전해요 — 세션이 이어서 해요', 'Sends your answer to this session — it carries on')}</dd><dt>{c.no}</dt><dd>{tr('하지 말라고 전해요', 'Tells it not to')}</dd><dt>{tr('그냥 두면', 'If you wait')}</dt><dd>{tr('세션은 여기서 기다려요 — 다른 일은 그대로 돌아요', 'The session waits — other work goes on')}</dd></dl>
      )}
      {c.options.length > 0 && (
        <div className="dc-opts">{c.options.map((o, i) => <button key={i} className="dc-btn dc-no" disabled={busy} onClick={(e) => answer(e, { pick: 'option', option: i })}>{o}</button>)}</div>
      )}
      <div className="dc-acts">
        {free === null && <button className="dc-link dc-free" onClick={() => setFree('')}>{tr('직접 답 쓰기', 'Write an answer')}</button>}
        {c.kind === 'login' && profile && <button className="dc-btn dc-no" onClick={() => openAgentModal(profile)}>{tr('크게 보기로 하기', 'Open big view')}</button>}
        {c.kind === 'login' && !profile && <span className="dc-muted">{tr(`로그인은 ${machine()} 앱 크게 보기에서`, `Sign in from the ${machine()} app big view`)}</span>}
        <button className="dc-btn dc-no" disabled={busy} onClick={(e) => answer(e, { pick: 'no' })}>{c.no}</button>
        <button className={`dc-btn dc-go ${danger ? 'dc-pay' : ''}`} disabled={busy} onClick={(e) => answer(e, { pick: 'yes' })}>{c.yes}</button>
      </div>
      {free !== null && (
        <div className="dc-freebox">
          <textarea value={free} onChange={(e) => setFree(e.target.value)} rows={2} placeholder={tr('예: 카드 말고 다음 주에 계좌로 다시 해 줘', 'e.g. Not by card — do it by bank transfer next week')} aria-label={tr('직접 답', 'Your answer')} />
          <div className="dc-muted">{tr(`이 글은 ${name} 입력칸에 네가 친 말로 들어가요`, `This goes into ${name}'s input as your own words`)}</div>
          <div className="dc-acts"><button className="dc-btn dc-no" onClick={() => setFree(null)}>{tr('접기', 'Close')}</button><button className="dc-btn dc-go" disabled={busy || !free.trim()} onClick={(e) => answer(e, { pick: 'text', text: free })}>{tr(`${name}에 보내기`, `Send to ${name}`)}</button></div>
        </div>
      )}
      {(err || c.state === 'failed') && <div className="dc-err" role="alert">{err || tr('못 보냈어요 — 다시 눌러 주세요', 'Not sent — press again')}</div>}
    </div>
  );
}

/** 이번 실행에 '보임'을 남긴 카드·화면 — 같은 줄을 또 안 쓴다 */
const marked = new Set<string>();
/**
 * 카드가 실제로 화면에 그려졌나(숨은 칸·가려진 창이 아니고) — 처음 보인 때 한 번 <데이터>/direct.jsonl 에 shown 줄.
 * 하위 세션의 scripts/direct ask 가 이걸 보고 "앱에 떴다/안 떴다"를 말한다(2026-10-05 — 참모가 기록에 ask 줄만 보고 떴다고 믿었다)
 */
function useShownMark(el: React.RefObject<HTMLElement | null>, id: string, place?: string) {
  useEffect(() => {
    if (!place || marked.has(`${id}:${place}`)) return;
    const key = `${id}:${place}`;
    const look = () => {
      const e = el.current;
      if (!e || document.hidden || marked.has(key) || !e.getClientRects().length) return;
      marked.add(key);
      void invoke('direct_shown', { id, place }).catch(() => marked.delete(key));
    };
    look();
    const t = window.setInterval(look, 1500);
    return () => window.clearInterval(t);
  }, [el, id, place]);
}

const TIDY_KEY = 'direct-dismissed';
const readTidy = (): Dismissed => { try { return JSON.parse(localStorage.getItem(TIDY_KEY) || '{}') as Dismissed; } catch { return {}; } };

/**
 * 카드 정리(2026-10-05) — 크게·한 줄·숨김(domain cardShow)과 치운 카드. 시계는 한 줄이 사라질 때만 깨운다(앱 전체를 매초 다시 그리지 않게)
 */
export function useDirectTidy(cards: DirectCard[]) {
  const [now, setNow] = useState(() => Date.now());
  const [gone, setGone] = useState<Dismissed>(readTidy);
  const next = Math.min(...cards.filter((c) => cardShow(c, now, gone) === 'line').map((c) => Date.parse(c.lastTs) + LINE_TTL));
  useEffect(() => {
    const t = window.setTimeout(() => setNow(Date.now()), Number.isFinite(next) ? Math.max(500, next - Date.now() + 50) : 60_000);
    return () => window.clearTimeout(t);
  }, [next, cards]);
  const show = (c: DirectCard) => cardShow(c, Math.max(now, Date.now()), gone);
  const hide = (c: DirectCard) => setGone((m) => {
    const n = dismiss(m, c);
    try { localStorage.setItem(TIDY_KEY, JSON.stringify(n)); } catch { /* 개인 정보 보호 모드 — 이번 화면에서만 */ }
    return n;
  });
  return { show, hide };
}

/** 답·처리가 끝난 카드 — 한 줄(무엇 · 결과 · 시각). 누르면 펼치고, X·옆으로 밀기로 바로 치운다 */
export function DirectLine({ c, name, onDismiss }: { c: DirectCard; name: string; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; dx: number; on: boolean } | null>(null);
  const swiped = useRef(false);
  const l = cardLine(c);
  const order = { sent: 1, got: 2, done: 3 } as Record<string, number>;
  const n = order[c.state] ?? 0;
  const step = (on: boolean, t: string) => <span className={on ? 'on' : ''}><i />{t}</span>;
  return (
    <div className="dc-done" role="group" aria-label={tr('끝난 직접 답', 'Finished direct answer')}
      style={dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.3, 1 - Math.abs(dx) / 240) } : undefined}
      onPointerDown={(e) => { if (e.button === 0) { drag.current = { x: e.clientX, y: e.clientY, dx: 0, on: false }; swiped.current = false; } }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const mx = e.clientX - d.x;
        if (!d.on && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(e.clientY - d.y)) { d.on = true; e.currentTarget.setPointerCapture(e.pointerId); }
        if (d.on) { d.dx = mx; setDx(mx); }
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d?.on) return;
        swiped.current = true; // 끌기 끝의 클릭은 펼치기로 안 받는다
        if (Math.abs(d.dx) > 80) onDismiss(); else setDx(0);
      }}
      onPointerCancel={() => { drag.current = null; setDx(0); }}
      onClickCapture={(e) => { if (swiped.current) { swiped.current = false; e.stopPropagation(); } }}>
      <div className="dc-line">
        <button className="dc-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="dc-av" aria-hidden="true">{(name || '?').slice(0, 1)}</span>
          <b>{name}</b><span className="dc-muted dc-what1">{l.what}</span>
          <span className="dc-res">{l.result}</span>
          <span className="dc-muted">{hm24(l.at)}</span>
        </button>
        <button className="dc-x" aria-label={tr('닫기', 'Dismiss')} title={tr('닫기', 'Dismiss')} onClick={onDismiss}><IconClose /></button>
      </div>
      {open && (
        <div className="dc-more">
          <div className="dc-muted">{c.q}</div>
          {c.answer && <div>{c.answer.label ?? tr('직접 답', 'Answered')} · {hhmm(c.answer.ts)}</div>}
          {n > 0 && c.answer && <div className="dc-steps">{step(n >= 1, tr('보냄', 'Sent'))}<em>—</em>{step(n >= 2, tr('세션이 받았음', 'Received'))}<em>—</em>{step(n >= 3, tr('처리됨', 'Done'))}</div>}
          {c.note && <div>{c.note}</div>}
        </div>
      )}
    </div>
  );
}

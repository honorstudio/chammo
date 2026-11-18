// 켤 때 점호(시안 docs/design-drafts/boot-loading v3 확정, 2026-11-17 사용자 "다 좋다").
// 앱이 다 준비될 때까지 참모가 가운데 한 줄로 서 있다가(깨어 있는 참모·깨울 차례만, 재워 둔 참모는 줄 아래 쉬는 묶음) 다 되면 —
// 또는 3초 상한에 — 띠 제자리로 날아가 앉고 덮개가 걷힌다. 그사이 뒤 화면은 다 그려 둔다. 판단은 domain/bootFace
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BOOT_CAP_MS, BOOT_KEY, bootGate, faceLook, memoRows, parseBootMemo, restGuess, type BootChief, type BootFace } from '../../domain/bootFace';
import { resolveAvatar, type AvatarEntry } from '../../domain/avatar';
import { OrchAvatar, useAvatars } from '../avatar';
import { BrandMark } from '../avatar/BrandMark';
import { motionOn } from '../calm';
import { useBootSignal } from './bootSignal';
import './boot.css';

/** 다음 켤 때 index.html 이 바로 그리는 첫 장면(점호 줄 그대로, 감은 눈) — 바탕색과 같이 */
export const BOOT_HTML_KEY = 'chammo.boot.html.v1';
export const BOOT_BG_KEY = 'chammo.boot.bg.v1';
/** 날기 — 다 준비된 뒤에 덧붙는 시간이라 짧게(시안 560ms·34ms 차례 → 아이맥 실측 0.86초 덧붙어 줄임, 2026-11-17) */
const FLY_MS = 440;
const FLY_STEP = 18;
/** 걷힌 뒤 꺼진 목록을 기다려 기억을 고치는 상한 — 안 오면 그냥 끝(덮개 사실 계산을 계속 돌리지 않게) */
const REST_WAIT_MS = 10_000;

export type BootRow = { key: string; name: string; label: string; color: string; face: BootFace };
/** sessions = 참모 목록 첫 응답 · meta = 고정·순서·맡은 일 · all = 재시작 기록(lost 를 안다) · restKnown = 꺼진 목록(쉬는 칸 숫자, 안 기다린다) · noChat = 위 띠에 참모가 없어 채팅 칸이 없다 */
export type BootFacts = { sessions: boolean; meta: boolean; all: boolean; restKnown?: boolean; noChat: boolean; top: BootRow[]; rest: BootRow[] };

const readMemo = () => { try { return parseBootMemo(localStorage.getItem(BOOT_KEY)); } catch { return null; } };
const memo0 = readMemo();

const Face = ({ c, size }: { c: BootRow; size: number }) => {
  const l = faceLook(c.face);
  return <OrchAvatar name={c.name} size={size} state={l.state} phase={l.phase} color={c.color} label={c.label} />;
};

/** 띠 자리(접힌 띠 = 프사 칸, 쉬는 칸) — 없으면(터미널 보기·띠가 아직 안 그려짐) 그 자리 없이 흐려지기만 */
const railPic = (key: string) => document.querySelector<HTMLElement>(`.lk-strip [data-flip="${CSS.escape(key)}"] .lk-av-pic`);
const railRest = () => document.querySelector<HTMLElement>('.lk-strip .rest-fold .rest-faces') ?? document.querySelector<HTMLElement>('.lk-strip .lk-rests');

/** 날기 — 가운데에서 띠 자리 가운데로, 크기는 자리 크기로(64 → 32, 쉬는 묶음 32 → 16). 위로 살짝 뜨며(호) */
function flyTo(el: HTMLElement, target: HTMLElement | null, delay: number): number {
  if (!target) { el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay, fill: 'forwards' }); return delay + 220; }
  const a = el.getBoundingClientRect(), b = target.getBoundingClientRect();
  const k = a.width ? Math.min(1, b.width / a.width) : 0.5;
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  // CSS 로 가운데 맞춘 자리(쉬는 묶음 translate(-50%…))는 그대로 두고 그 위에 더한다
  const base = getComputedStyle(el).transform;
  const at = (t: string) => (base && base !== 'none' ? `${t} ${base}` : t);
  el.animate([
    { transform: at('translate(0px, 0px) scale(1)') },
    { transform: at(`translate(${dx * 0.55}px, ${dy * 0.45 - 40}px) scale(${(1 + k) / 2})`), offset: 0.5 },
    { transform: at(`translate(${dx}px, ${dy}px) scale(${k})`) },
  ], { duration: FLY_MS, delay, easing: 'cubic-bezier(.45, 0, .2, 1)', fill: 'forwards' });
  return delay + FLY_MS;
}

/** 다음 첫 장면 — 지금 줄을 본떠 감은 눈으로(살아 있던 참모 = 깨울 차례 얼굴, 쉬는 묶음 = 그대로). 이름표·역할은 뺀다 */
function saveFirstFrame(root: HTMLElement) {
  try {
    const c = root.cloneNode(true) as HTMLElement;
    c.querySelector('.bt-bg')?.remove();
    c.querySelectorAll<HTMLElement>('.oa').forEach((o) => {
      o.className = o.closest('.bt-row') ? 'oa oa-st-off oa-ph-queued' : 'oa oa-st-off';
      o.removeAttribute('role');
      o.removeAttribute('aria-label');
    });
    localStorage.setItem(BOOT_HTML_KEY, c.innerHTML);
    localStorage.setItem(BOOT_BG_KEY, getComputedStyle(root.querySelector('.bt-bg')!).backgroundColor);
  } catch { /* 이번엔 못 남김 — 다음 첫 장면은 바탕만 */ }
}

function saveMemo(rows: BootRow[], saved: Map<string, AvatarEntry>) {
  try {
    localStorage.setItem(BOOT_KEY, JSON.stringify({ v: 1, at: Date.now(), chiefs: rows.map((c): BootChief => {
      const av = resolveAvatar(saved, c.name);
      return { key: c.key, name: c.name, label: c.label, color: c.color, shape: av.kind === 'preset' ? av.shape : 'mochi', eyes: av.kind === 'preset' ? av.eyes : 'pill', face: c.face };
    }) }));
  } catch { /* 기억 못 남김 — 다음엔 대표 캐릭터부터 */ }
}

/** 날 때 쉬는 묶음이 지난번 기억이었으면(꺼진 목록 전) 꺼진 목록으로 기억과 첫 장면 숫자를 고친다 — 안 고치면 틀린 묶음이 매번 다시 저장됐다 */
function fixRest(drawn: BootRow[], rows: BootRow[], n: number, saved: Map<string, AvatarEntry>) {
  const real = rows.filter((c) => c.face === 'resting').map((c) => c.key).join();
  if (drawn.map((c) => c.key).join() === real) return;
  saveMemo(rows, saved);
  try {
    const box = document.createElement('div');
    box.innerHTML = localStorage.getItem(BOOT_HTML_KEY) ?? '';
    const g = box.querySelector('.bt-rest');
    if (!g) return;
    if (n) g.querySelector('b')!.textContent = String(n);
    else g.remove();
    localStorage.setItem(BOOT_HTML_KEY, box.innerHTML);
  } catch { /* 첫 장면은 다음 날기 때 새로 */ }
}

/** onDone = 걷혔다(App 이 덮개와 사실 계산을 뺀다) */
export function BootRollcall({ enabled, facts, onDone }: { enabled: boolean; facts: BootFacts; onDone?: () => void }) {
  const [phase, setPhase] = useState<'roll' | 'fly' | 'gone'>(enabled ? 'roll' : 'gone');
  const chat = useBootSignal('chat');
  const { saved, known: avatarsKnown } = useAvatars();
  const root = useRef<HTMLDivElement>(null);
  const flew = useRef<BootRow[] | null>(null); // 날아갈 때 그린 쉬는 묶음 — 걷힌 뒤 꺼진 목록과 다르면 기억을 고친다
  const [, setTick] = useState(0);
  // index.html 첫 장면을 이어받는다 — 덮개가 같은 자리에 그려진 뒤 지운다
  useLayoutEffect(() => { document.getElementById('boot')?.remove(); }, []);
  // 상한 — 데이터가 안 와도 이때 한 번 더 따진다(영원히 안 끝나지 않게)
  useEffect(() => {
    if (phase !== 'roll') return;
    const t = window.setTimeout(() => setTick((n) => n + 1), Math.max(0, BOOT_CAP_MS - performance.now()) + 20);
    return () => window.clearTimeout(t);
  }, [phase]);
  // 참모 목록·재시작 기록이 둘 다 와야 사실로 — 목록만 오면 lost 참모가 줄에서 빠졌다가 깨울 차례로 돌아온다. 그 전엔 지난번 기억
  const known = facts.sessions && facts.all;
  const mem = memoRows(memo0);
  const top: BootRow[] = known ? facts.top : mem.top;
  // 꺼진 목록(가장 늦게 온다) 전엔 짐작 — 지난번 점호에 있었는데 지금 위 띠에 없는 참모(그사이 재운 참모)
  const rest: BootRow[] = !known ? mem.rest : facts.restKnown ? facts.rest : restGuess([...mem.top, ...mem.rest], top).map((c) => ({ ...c, face: 'resting' as const }));
  const gate = bootGate({ elapsed: performance.now(), data: { sessions: facts.sessions, roles: facts.meta, avatars: avatarsKnown, all: facts.all, chat }, faces: known ? [...top, ...rest].map((c) => c.face) : ['waking'], noChat: facts.noChat });
  useEffect(() => { if (phase === 'roll' && gate.done) setPhase('fly'); }, [phase, gate.done]);
  // 첫 설치 창·터미널 보기로 바뀌면 바로 걷는다(설정은 첫 그림 뒤에 온다)
  useEffect(() => { if (!enabled && phase === 'roll') setPhase('gone'); }, [enabled, phase]);
  // 다 됨(또는 상한) — 다음 첫 장면을 남기고, 띠 제자리로 날아가 앉는다. 동작 줄이기면 흐려지기만
  useLayoutEffect(() => {
    if (phase !== 'fly') return;
    const el = root.current;
    if (!el) { setPhase('gone'); return; }
    el.style.pointerEvents = 'none'; // 날기 시작하면 누름은 아래 앱으로(다 준비된 뒤라 날기 0.8초를 기다리게 하지 않는다)
    saveFirstFrame(el);
    saveMemo([...top, ...rest], saved);
    flew.current = rest;
    const moving = motionOn();
    document.documentElement.classList.add('boot-fly');
    let end = 0;
    el.querySelectorAll<HTMLElement>('.bt-cell').forEach((cell, i) => {
      const t = moving ? railPic(cell.dataset.key!) : null;
      cell.querySelector<HTMLElement>('.bt-floor')?.style.setProperty('opacity', '0');
      end = Math.max(end, flyTo(cell, t, moving ? i * FLY_STEP : 0));
    });
    const group = el.querySelector<HTMLElement>('.bt-rest');
    if (group) end = Math.max(end, flyTo(group, moving ? railRest() : null, moving ? 60 : 0));
    el.querySelector<HTMLElement>('.bt-brand')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    el.querySelector('.bt-bg')!.animate([{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: moving ? FLY_MS + 60 : 220, easing: 'ease-out', fill: 'forwards' });
    const done = window.setTimeout(() => { document.documentElement.classList.remove('boot-fly'); setPhase('gone'); }, Math.max(end, moving ? FLY_MS + 60 : 220) + 40);
    return () => { window.clearTimeout(done); document.documentElement.classList.remove('boot-fly'); };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  // 걷힌 뒤 — 꺼진 목록이 와 있으면 기억(쉬는 묶음)을 고쳐 남기고 끝, 아직이면 올 때까지(상한 REST_WAIT_MS). 날아간 적 없으면(첫 설치·터미널 보기) 기억은 그대로
  useEffect(() => {
    if (phase !== 'gone') return;
    if (facts.restKnown) { if (flew.current) fixRest(flew.current, [...facts.top, ...facts.rest], facts.rest.length, saved); onDone?.(); return; }
    const t = window.setTimeout(() => onDone?.(), REST_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [phase, facts.restKnown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (phase === 'gone') return null;
  const shown = rest.slice(0, 3);
  return (
    <div ref={root} className="bt-ov" aria-busy="true" aria-label="Chammo">
      <div className="bt-bg" />
      {top.length > 0 && (
        <div className="bt-row">
          {top.map((c) => <div key={c.key} className="bt-cell" data-key={c.key}><i className="bt-floor" /><Face c={c} size={64} /></div>)}
        </div>
      )}
      {rest.length > 0 && (
        <div className={`bt-rest${top.length ? '' : ' solo'}`}>
          <span className="bt-faces">{shown.map((c) => <span key={c.key}><Face c={c} size={32} /></span>)}</span>
          <b>{rest.length}</b>
        </div>
      )}
      {!top.length && !rest.length && <div className="bt-row bt-brand"><div className="bt-cell"><BrandMark size={64} /></div></div>}
    </div>
  );
}

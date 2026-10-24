// 폰에서 음성 모드 소리 틀기 — 오디오 원소·하트비트·소리 받기(2026-10-11 사용자). 판단은 domain/phoneVoice, 맥 쪽은 src-tauri/src/phone_voice.rs.
//
// iOS 는 사람이 누르기 전엔 소리를 못 튼다(앱을 열자마자 play() 는 NotAllowedError). 실측(.shots/feature-phone-voice/ios-autoplay-log.txt, 시뮬레이터 사파리):
// 누름 안에서 play() 를 한 번 겪은 오디오 원소는 그 뒤 누름 없이 src 만 바꿔 틀어도 됐다(40초 뒤·홈에 갔다 돌아와서도). 그래서 오디오 원소를 하나만 두고,
// 음성 모드가 켜진 채 첫 누름(또는 음성 단추 누름)에서 무음 파일을 틀어 풀어 둔다. 풀리기 전·막히면 ready=false 로 알려 맥이 소리를 낸다 — 소리가 사라지진 않는다.
import { BEAT_MS, beatBody, cancelStep, isReady, pickItem, silentWav, type Ack, type AckKind, type Item, type PhoneSay } from '../domain/phoneVoice';
import { voiceAudioBlob, voiceBeat } from './web';
import { makeDuck, type AudioSessionLike } from '../domain/audioDuck';

const BEAT_TIMEOUT_MS = 5000;
const AUDIO_TIMEOUT_MS = 15000;

let el: HTMLAudioElement | null = null;
let unlocked = false;
let on = false;
let lastTouch = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let sending = false;
let sent: Ack | undefined; // 지금 가는 소식 — 못 가면 되돌린다
let seenCancel: number | null = null;
const handled = new Set<number>();
const acks: Ack[] = [];
let current: { id: number; url: string; dk: number } | null = null;
/** 말하는 동안만 다른 앱 소리를 잠깐 줄인다(audioSession transient) — 기본으로 틀면 듣던 음악·영상이 멈췄다(2026-10-23 사용자) */
const duck = makeDuck(() => (typeof navigator === 'undefined' ? undefined : (navigator as { audioSession?: AudioSessionLike }).audioSession));
let wired = false;
/** 지금(또는 방금) 튼 소리 — 입력칸 참모 단추가 말하는 참모로 바뀐다(ui/mobile/usePhoneSpeaker) */
let say: PhoneSay | null = null;
const saySubs = new Set<() => void>();
const setSay = (next: PhoneSay | null) => { say = next; saySubs.forEach((f) => f()); };
/** 틀던 소리가 끝·실패·멈춤 — 끝난 때를 적는다(말한 참모 프사는 domain HOLD_MS 동안 더 남는다) */
const sayEnded = (id: number) => { if (say && say.id === id && say.endedMs === null) setSay({ ...say, endedMs: Date.now() }); };
export const subscribeSay = (f: () => void) => { saySubs.add(f); return () => { saySubs.delete(f); }; };
export const getSay = () => say;

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const audio = () => (el ??= typeof Audio === 'undefined' ? null : new Audio());
const ready = () => isReady({ unlocked, visible: visible(), lastTouch, now: Date.now() });

/** 사람이 누른 그 순간(누름 처리기 안에서 동기로)에 불러야 한다 — 무음 파일을 한 번 틀어 오디오 원소를 풀어 둔다 */
export function unlockAudio(): void {
  const a = audio();
  if (!a || unlocked) return;
  const url = URL.createObjectURL(new Blob([silentWav() as BlobPart], { type: 'audio/wav' }));
  a.src = url;
  const dk = duck.begin('ambient'); // 무음 풀기는 섞어 튼다 — 듣던 음악이 이 순간 끊기지 않게
  a.play().then(
    () => { unlocked = true; beatSoon(); },
    () => { unlocked = false; },
  ).finally(() => setTimeout(() => { URL.revokeObjectURL(url); duck.end(dk); }, 2000));
}

function touched() {
  const wasIdle = !ready();
  lastTouch = Date.now();
  if (on && wasIdle && unlocked) beatSoon(); // 한동안 안 만지다 다시 만졌다 — 곧바로 '보는 중'
}

/** 오디오는 touchend·click 에서만 풀린다(iOS 는 touchstart 를 사람의 누름으로 안 친다). 음성 모드가 꺼져 있으면 안 푼다 — 안 쓰는 사람의 음악을 끊지 않게 */
function gesture() {
  if (on && !unlocked) unlockAudio();
}

function wire() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  for (const ev of ['pointerdown', 'touchstart', 'keydown']) document.addEventListener(ev, touched, { capture: true, passive: true });
  for (const ev of ['touchend', 'click']) document.addEventListener(ev, gesture, { capture: true, passive: true });
  document.addEventListener('scroll', () => { lastTouch = Date.now(); }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!on) return;
    if (visible()) { start(); void beat(); } else { stop(); void beat(true); }
  });
}

function start() {
  if (timer) return;
  timer = setInterval(() => void beat(), BEAT_MS);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
let soon: ReturnType<typeof setTimeout> | undefined;
/** 소식을 다음 간격까지 안 기다리고 곧 보낸다(연달은 부름은 한 번으로) */
function beatSoon() {
  if (soon) return;
  soon = setTimeout(() => { soon = undefined; void beat(); }, 50);
}
function ack(id: number, s: AckKind) {
  acks.push({ id, s });
  beatSoon();
}

async function beat(hidden = false): Promise<void> {
  if (!on && !hidden) return;
  if (sending && !hidden) return;
  sending = true;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), BEAT_TIMEOUT_MS); // 매달린 요청이 고리를 영영 멈추지 않게
  try {
    const a = hidden ? undefined : acks.shift(); // 떠난다는 소식은 지난 소리 소식을 가져가지 않는다
    sent = a;
    const r = await voiceBeat(beatBody(hidden ? false : ready(), hidden, a), ctl.signal, hidden);
    if (hidden) return;
    const c = cancelStep(seenCancel, r.cancel);
    seenCancel = c.seen;
    if (c.stop) stopCurrent();
    const it = pickItem(r, handled);
    if (it) { handled.add(it.id); void play(it); }
    if (acks.length) beatSoon();
  } catch {
    // 못 보내면 맥은 곧 '폰이 화면을 떠났다'로 보고 맥에서 낸다 — 소식은 잃지 않게 되돌려 두고 다음 간격에 다시
    if (sent) acks.unshift(sent);
  } finally {
    clearTimeout(t);
    sending = false;
  }
}

async function play(it: Item): Promise<void> {
  const { id } = it;
  const a = audio();
  if (!a || !ready()) { ack(id, 'fail'); return; }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), AUDIO_TIMEOUT_MS);
  try {
    const blob = await voiceAudioBlob(id, ctl.signal);
    const url = URL.createObjectURL(blob);
    release();
    current = { id, url, dk: duck.begin('transient') };
    a.onended = () => { if (current?.id === id) { ack(id, 'end'); release(); sayEnded(id); } };
    a.onerror = () => { if (current?.id === id) { ack(id, 'fail'); release(); sayEnded(id); } };
    a.src = url;
    await a.play();
    ack(id, 'start');
    setSay({ id, who: it.who, startedMs: Date.now(), endedMs: null, hop: it.hop, env: it.env });
  } catch (e) {
    // 막혔다(NotAllowedError)면 다시 풀릴 때까지 준비 안 됨 — 맥이 이 소리를 맡는다
    if ((e as { name?: string })?.name === 'NotAllowedError') unlocked = false;
    release();
    ack(id, 'fail');
    sayEnded(id);
  } finally {
    clearTimeout(t);
  }
}

function release() {
  if (current) {
    URL.revokeObjectURL(current.url);
    duck.end(current.dk);
    // 잠금 화면 '지금 재생' 칸에 음악처럼 남지 않게
    try { if (navigator.mediaSession) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } } catch { /* 없는 브라우저 */ }
  }
  current = null;
}
/** 맥이 음성을 멈췄다 — 틀던 소리도 멈춘다 */
function stopCurrent() {
  const a = el;
  if (!a || !current) return;
  const id = current.id;
  a.onended = null;
  a.onerror = null;
  a.pause();
  release();
  sayEnded(id);
}

/** 음성 모드가 켜지고 꺼질 때(맥 음성 모드 값을 읽은 것) — 켜진 동안만 하트비트를 보낸다. 같은 값이면 아무 일도 안 한다 */
export function setPhoneVoice(next: boolean): void {
  wire();
  if (next === on) return;
  on = next;
  if (on) {
    seenCancel = null;
    if (visible()) { start(); void beat(); }
  } else {
    stop();
    stopCurrent();
    if (visible()) void beat(true); // 맥이 바로 '폰 안 봄'으로 — 소리 파일을 내놓고 기다리지 않게
  }
}

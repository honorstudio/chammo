// 키즈 패드 화면 E2E(11-17 셋째 조각) — 진짜 KidsScreen 을 가짜 키즈 길(api)로. ?who=blue|green|orange ?asleep=1
// window.__said 에 보낸 말, window.__reply(text) 로 아이 세션 답을 흉내 낸다
import { createRoot } from 'react-dom/client';

const q = new URLSearchParams(location.search);
const W = window as unknown as { __said: string[]; __left: number; __reply: (t: string) => void };
W.__said = [];
W.__left = 0;
const looks: Record<string, unknown> = {
  blue: { kind: 'preset', shape: 'mochi', eyes: 'pill', color: '#2f74e0' },
  green: { kind: 'preset', shape: 'cloud', eyes: 'pupil', color: '#1f9a62' },
  orange: { kind: 'preset', shape: 'bun', eyes: 'dark', color: '#d9622b' },
};
const rows: { ts: number; who: string; text: string }[] = [];
W.__reply = (text) => rows.push({ ts: Date.now(), who: 'assistant', text });
// ?demo=1 — 시뮬레이터 캡처용: 열고 2.5초 뒤 아이 세션 답이 온 것처럼(손 없이 말풍선·종이 그림까지)
if (q.get('demo')) setTimeout(() => W.__reply('좋아! 공룡 점프 게임을 만들었어. 톡 누르면 공룡이 껑충 뛰어.'), 2500);
// ?voice=1 — 목소리(넷째 조각): 가짜 마이크(1.2초 소리 → 조용)·가짜 맥(미리 받아쓰기·받아쓰기·답 조각 둘). ?nomic=1 이면 마이크 거절
const V = window as unknown as { __peek: number; __hear: number[]; __clips: number; __speak: () => void; __turnLog: { ev: string; follow: boolean; lv: number }[] };
V.__peek = 0; V.__hear = []; V.__clips = 0; V.__turnLog = [];
const voiceOn = !!q.get('voice');
let speakUntil = 0;
V.__speak = () => { speakUntil = performance.now() + 1200; };
if (voiceOn) {
  const md = navigator.mediaDevices ?? ((navigator as unknown as { mediaDevices: MediaDevices }).mediaDevices = {} as MediaDevices);
  md.getUserMedia = async () => {
    if (q.get('nomic')) throw new Error('NotAllowedError');
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain(), dst = ctx.createMediaStreamDestination();
    o.frequency.value = 220; o.connect(g).connect(dst); o.start();
    g.gain.value = 0;
    setInterval(() => { g.gain.value = performance.now() < speakUntil ? 0.6 : 0.0005; }, 20);
    return dst.stream;
  };
}
const beep = async (ms: number) => {
  const { wavBytes } = await import('@src/domain/kidsTurn');
  const n = Math.round(16 * ms), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.2 * Math.sin(i / 4);
  return wavBytes(x, 16000).buffer as ArrayBuffer;
};
let clipsAt = 0;
let fails = 0;
// ?works=1 — 작품(다섯째 조각): 말하고 0.6초 뒤 진짜 게임 틀이 작품으로 생기고, 2초 뒤 한 번 더 고쳐진다(제목 바뀜)
const works: { name: string; title: string; mtime: number; html: string }[] = [];
const W5 = window as unknown as { __workFetch: number };
W5.__workFetch = 0;
const addWork = async () => {
  const t = (await import('../../src-tauri/kids/templates/game.html?raw')).default;
  works.unshift({ name: 'dino-pizza', title: '공룡이 피자 먹는 게임', mtime: Date.now(), html: t.replace('"title":"공룡 점프"', '"title":"공룡 피자"') });
  setTimeout(() => { works[0]!.html = works[0]!.html.replace('"title":"공룡 피자"', '"title":"공룡 피자 냠냠"'); works[0]!.mtime = Date.now(); }, 2000);
};
const voice = {
  peek: async () => { V.__peek++; return { text: '공룡 그려 줘', more: false }; },
  turnLog: async (e: { ev: string; follow: boolean; lv: number }) => { V.__turnLog.push(e); },
  hear: async (wav: Uint8Array) => { V.__hear.push(wav.length); if (q.get('emptyhear')) return { text: '' }; clipsAt = Date.now() + 400; if (q.get('works')) setTimeout(() => void addWork(), 600); W.__reply('공룡 그릴게! 초록색으로 할까?'); return { text: '공룡 그려 줘' }; },
  clip: async (_c: string, n: number) => (Date.now() < clipsAt ? null : n < 2 ? (V.__clips++, beep(600)) : 'end'),
  pre: () => beep(300),
};
// ?pk=1 — 이 기기가 패스키를 쓴다(가짜 인증기). 등록 → 얼굴 칸으로 나가기(일곱째 조각)
const PK = window as unknown as { __pkReg: number; __pkLeave: number; __pkRegistered: boolean };
PK.__pkReg = 0; PK.__pkLeave = 0; PK.__pkRegistered = false;
if (q.get('pk')) {
  (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = { isUserVerifyingPlatformAuthenticatorAvailable: async () => true };
  const ab = (...b: number[]) => new Uint8Array(b).buffer;
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    create: async () => ({ id: 'a2V5', response: { clientDataJSON: ab(1), getAuthenticatorData: () => ab(2), getPublicKey: () => ab(3) } }),
    get: async () => ({ id: 'a2V5', response: { clientDataJSON: ab(1), authenticatorData: ab(2), signature: ab(4) } }),
  } });
}
const passkey = {
  challenge: async () => ({ challenge: 'AQID', ids: PK.__pkRegistered ? ['a2V5'] : [] }),
  register: async (pin: string) => { if (pin !== '2580') { fails++; return { ok: false as const, wrong: true, waitMs: 0 }; } PK.__pkReg++; PK.__pkRegistered = true; return { ok: true as const }; },
  leave: async () => { if (!PK.__pkRegistered) return { ok: false as const, wrong: true, waitMs: 0 }; PK.__pkLeave++; W.__left++; return { ok: true as const }; },
};
const api = {
  me: async () => ({ key: '참모-2', on: !q.get('asleep'), child: '서아', avatar: looks[q.get('who') ?? 'blue'], voice: voiceOn, voiceMode: 'tap' as const, passkey: PK.__pkRegistered }),
  passkey: q.get('pk') ? passkey : undefined,
  voice: voiceOn ? voice : undefined,
  works: async () => works.map(({ html: _h, ...w }) => w),
  work: async (name: string) => { W5.__workFetch++; return works.find((w) => w.name === name)!.html; },
  say: async (text: string) => { W.__said.push(text); rows.push({ ts: Date.now(), who: 'kid', text }); },
  log: async () => rows.slice(),
  // 보호자 숫자 2580(가짜 맥) — 틀리면 세 번째부터 쉬기
  leave: async (pin?: string) => {
    if (pin === '2580') { W.__left++; return { ok: true as const }; }
    fails++;
    return { ok: false as const, wrong: true, waitMs: fails >= 3 ? 30_000 : 0 };
  },
  // ?left=0 — 하루 시간이 다 된 채로(마무리 장면), 아니면 20분
  tick: async () => ({ usedMs: 0, limitMs: 1_200_000, leftMs: q.get('left') === '0' ? 0 : 1_200_000 }),
};

(async () => {
  // 하루 시간이 다 된 채로(?left=0&works=1) 열면 오늘 만든 작품 하나가 이미 있다 — 그리기 전에 넣는다
  // (전엔 void 로 넣어 화면이 먼저 목록을 읽으면 0개라 '인사'가 몇 ms 만에 지나 시험이 가끔 실패했다)
  if (q.get('left') === '0' && q.get('works')) await addWork();
  const { KidsScreen } = await import('@src/ui/kids/KidsScreen');
  createRoot(document.getElementById('root')!).render(<KidsScreen api={api} />);
})();

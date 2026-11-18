// 아이 말 시작·끝 판정과 녹음 묶기(넷째 조각, 계획서 D '말 시작·끝') — 화면 없이 시험되는 부분.
// 톡 = 듣기 시작(손을 떼도 안 끊김). 말 전엔 4초에 한 번 부르고 8초면 그만. 말하는 중 0.45초 쉬면 맥에 미리 받아쓰기를 맡겨
// '말이 끝났나'(11-18 사용자): 끝남이면 바로 대답, 모름이면 0.9초, 이어 갈 것 같으면 추임새 한 번 + 3초까지 더 듣기.
// 받아쓰기가 늦어도 3초 쉼이면 끝, 한 번에 30초까지

/** peek: none = 아직 · pending = 맥이 받아쓰는 중 · end = 끝난 말 · more = 이어 갈 것 같음 · unsure = 모름(맥 kids_turn 판정)
 *  fillered = 이 쉼에 추임새를 이미 냈나(한 번만) */
export type PeekJudge = 'end' | 'more' | 'unsure';
export type Turn = { sinceStart: number; spoke: boolean; silence: number; peek: 'none' | 'pending' | PeekJudge; nudged: boolean; fillered?: boolean };
export type TurnAct = 'wait' | 'nudge' | 'giveup' | 'peek' | 'filler' | 'end';

/** 문턱(ms) — peek·unsure·more 는 맥 kids.json "turn" 으로 고친다(11-18 사용자 — 진짜 5살 말투에 맞추게) */
export const TURN = { nudge: 4000, giveup: 8000, peek: 450, unsure: 900, more: 3000, endMax: 3000, max: 30_000, speech: 0.02, mute: 350, callLoop: 3 };
export type TurnRules = typeof TURN;

/** 맥이 준 문턱(/api/kids/me turn)을 얹는다 */
export function turnRules(m?: { peekMs?: number; unsureMs?: number; moreMs?: number; speechLevel?: number }): TurnRules {
  return { ...TURN, ...(m?.peekMs ? { peek: m.peekMs } : {}), ...(m?.unsureMs ? { unsure: m.unsureMs } : {}), ...(m?.moreMs ? { more: m.moreMs } : {}), ...(m?.speechLevel ? { speech: m.speechLevel } : {}) };
}

/** 말인가 — 소리를 내는 중(시작 소리·답·미리 만든 말)과 끝난 직후 여유(mute) 동안은 말로 안 친다(11-18 실사용: 시작 소리가 말로 잡혔을 수 있다) */
export function isSpeech(level: number, floor: number, r: TurnRules, muted: boolean): boolean {
  return !muted && level > Math.max(r.speech, floor * 3);
}

/** 답 뒤 계속 듣기 — n 번째 조용한 바퀴(8초)가 끝날 때. 어린아이는 다시 톡을 기대하기 어렵다 — 화면이 떠 있는 동안 계속 듣고, callLoop 번째에 한 번 먼저 불러 본다 */
export function quietLoop(n: number, r: TurnRules = TURN): 'listen' | 'call' {
  return n === r.callLoop ? 'call' : 'listen';
}

export function turnStep(s: Turn, r: TurnRules = TURN): TurnAct {
  if (s.sinceStart >= r.max) return s.spoke ? 'end' : 'giveup';
  if (!s.spoke) {
    if (s.sinceStart >= r.giveup) return 'giveup';
    if (s.sinceStart >= r.nudge && !s.nudged) return 'nudge';
    return 'wait';
  }
  if (s.peek === 'end') return 'end';
  if (s.peek === 'unsure') return s.silence >= r.unsure ? 'end' : 'wait';
  if (s.peek === 'more') return !s.fillered ? 'filler' : s.silence >= r.more ? 'end' : 'wait';
  if (s.silence >= r.endMax) return 'end'; // 받아쓰기가 늦다
  if (s.peek === 'none' && s.silence >= r.peek) return 'peek';
  return 'wait';
}

/** 마지막 말에서 끝(또는 추임새)까지 기다린 시간 — 85ms 마다(마이크 조각), 받아쓰기 왕복 rtt 가정. 전후 비교용 */
export function endWaitMs(judge: PeekJudge, rtt: number, r: TurnRules = TURN, untilFiller = false): number {
  const s: Turn = { sinceStart: 1000, spoke: true, silence: 0, peek: 'none', nudged: true };
  let at = -1;
  for (let ms = 0; ms < 10_000; ms += 85) {
    s.silence = ms;
    if (s.peek === 'pending' && ms - at >= rtt) s.peek = judge;
    const a = turnStep(s, r);
    if (a === 'peek') { s.peek = 'pending'; at = ms; }
    if (a === 'filler') { if (untilFiller) return ms; s.fillered = true; }
    if (a === 'end') return ms;
  }
  return -1;
}

/** 마이크 표본 → 16kHz(구간 평균 — 받아쓰기엔 충분) */
export function downsample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const r = from / to;
  const out = new Float32Array(Math.floor(x.length / r));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * r), b = Math.min(x.length, Math.floor((i + 1) * r));
    let s = 0;
    for (let j = a; j < b; j++) s += x[j]!;
    out[i] = b > a ? s / (b - a) : 0;
  }
  return out;
}

/** 16비트 모노 wav — 맥 /api/kids/peek·hear 몸 그대로 */
export function wavBytes(x: Float32Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), true);
  return new Uint8Array(buf);
}

/** 소리 크기(RMS) */
export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
}

// 폰 음성 소리가 끝난 뒤에도 남의 소리를 끊고 '지금 재생'을 쥐고 있었다(2026-11-12 사용자 — 유튜브가 중간에 멈춤 · 지금 재생이 참모로 고정).
// WebKit(iOS 26.5 시뮬레이터 로그)은 한 번 소리를 낸 원소가 남아 있으면 type 을 'auto' 로 돌리는 순간 분류를 MediaPlayback(안 섞임)으로 올리고
// 지금 재생 등록도 그대로 둔다. 원소를 muted 로 두면 '지금 재생 정보 지움' + 분류 내림이 찍혔다 — 그래서 쉬는 원소는 늘 muted 이고,
// type 을 원래 값으로 돌리는 순간에도 이미 muted 여야 한다. 가짜 Audio·navigator 위에서 진짜 흐름(풀기 → 하트비트 → 틀기 → 끝 → 끄기)을 돌린다
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let reply: object = {};
vi.mock('./web', () => ({
  voiceBeat: async () => { const r = reply; reply = {}; return r; },
  voiceAudioBlob: async () => new Blob(['x']),
}));

class FakeAudio {
  static last: FakeAudio;
  src = '';
  muted = false;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** play() 때 원소가 음소거였나 */
  playedMuted: boolean[] = [];
  constructor() { FakeAudio.last = this; }
  play() { this.playedMuted.push(this.muted); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
/** 소리 세션 type 이 바뀔 때마다 (값, 그때 원소가 음소거였나) — 'auto' 로 돌리는 순간 소리 낼 수 있는 원소가 있으면 WebKit 이 MediaPlayback 으로 올린다 */
const sets: { t: string; muted: boolean | undefined }[] = [];
const session = {
  v: 'auto',
  get type() { return this.v; },
  set type(t: string) { this.v = t; sets.push({ t, muted: FakeAudio.last?.muted }); },
};
const docHandlers = new Map<string, (() => void)[]>();
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const fire = (...types: string[]) => { for (const t of types) for (const f of docHandlers.get(t) ?? []) f(); };

beforeAll(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('navigator', { audioSession: session, mediaSession: { metadata: null, playbackState: 'none' } });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: (t: string, f: () => void) => docHandlers.set(t, [...(docHandlers.get(t) ?? []), f]) });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('쉬는 동안 음성 원소는 남의 소리·지금 재생을 쥐지 않는다', () => {
  it('풀기·말하기는 소리를 내고, 끝나 원래 type 으로 돌리는 순간엔 이미 음소거', async () => {
    const { setPhoneVoice } = await import('./phoneVoice');
    setPhoneVoice(true);
    await tick();
    fire('pointerdown', 'click'); // 사람이 누름 → 무음으로 풀기
    const a = FakeAudio.last;
    await tick(2100);
    expect(session.type).toBe('auto');
    expect(a.muted).toBe(true); // 풀기 끝 — 쉬는 원소
    expect(sets.filter((s) => s.t === 'auto').every((s) => s.muted)).toBe(true);

    reply = { item: { id: 7, ms: 1200, who: 'o1' } };
    await tick(5000); // 하트비트가 소리를 받아 튼다
    expect(a.playedMuted.at(-1)).toBe(false); // 말할 땐 들려야 한다
    expect(session.type).toBe('transient');

    a.onended?.();
    expect(a.muted).toBe(true);
    expect(session.type).toBe('auto');
    expect(sets.filter((s) => s.t === 'auto').every((s) => s.muted)).toBe(true);

    // 음성 모드를 꺼도 원소는 음소거·멈춤 — 끈 뒤에 남의 소리를 끊을 원소가 안 남는다
    setPhoneVoice(false);
    expect(a.muted).toBe(true);
    expect(a.paused).toBe(true);
  });

  it('말하는 도중 음성 모드를 끄면 바로 멈추고 음소거한 뒤 원래 type', async () => {
    const { setPhoneVoice } = await import('./phoneVoice');
    setPhoneVoice(true);
    await tick();
    fire('pointerdown'); // 다시 만짐 — 보는 중
    reply = { item: { id: 8, ms: 1200, who: 'o1' } };
    await tick(2000);
    const a = FakeAudio.last;
    expect(a.paused).toBe(false);
    expect(session.type).toBe('transient');
    setPhoneVoice(false);
    expect(a.paused).toBe(true);
    expect(a.muted).toBe(true);
    expect(session.type).toBe('auto');
    expect(sets.at(-1)).toEqual({ t: 'auto', muted: true });
  });
});

// 폰 음성 소리가 듣던 음악·영상을 멈췄다(2026-10-23 사용자) — 진짜 재생 흐름(누름으로 풀기 → 하트비트 → 틀기 → 끝)을 가짜 Audio·navigator 위에서 돌려
// 말하는 동안만 audioSession.type 이 transient, 풀기(무음)는 ambient, 끝나면 원래 값, 잠금 화면 '지금 재생'은 비우는지 본다. 진짜 소리는 사용자 폰 실측
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const beats: object[] = [];
let reply: object = {};
vi.mock('./web', () => ({
  voiceBeat: async (body: object) => { beats.push(body); const r = reply; reply = {}; return r; },
  voiceAudioBlob: async () => new Blob(['x']),
}));

class FakeAudio {
  static last: FakeAudio;
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  played: string[] = [];
  constructor() { FakeAudio.last = this; }
  play() { this.played.push(session.type); return Promise.resolve(); }
  pause() {}
}
const session = { type: 'auto' };
const media = { metadata: {} as unknown, playbackState: 'playing' };
const docHandlers = new Map<string, (() => void)[]>();
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeAll(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('navigator', { audioSession: session, mediaSession: media });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: (t: string, f: () => void) => docHandlers.set(t, [...(docHandlers.get(t) ?? []), f]) });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('음성 소리 — 다른 앱 소리를 끊지 않게', () => {
  it('풀기(무음)는 섞어 틀고, 말할 땐 잠깐 줄이고, 끝나면 원래대로 + 지금 재생 칸 비움', async () => {
    const { setPhoneVoice } = await import('./phoneVoice');
    setPhoneVoice(true);
    await tick();
    for (const t of ['pointerdown', 'click']) for (const f of docHandlers.get(t) ?? []) f(); // 사람이 누름 → 오디오 풀기
    const a = FakeAudio.last;
    expect(a.played).toEqual(['ambient']);
    await tick(2100); // 풀기 끝 — 원래 값
    expect(session.type).toBe('auto');

    reply = { item: { id: 7, ms: 1200, who: 'o1' } };
    await tick(5000); // 다음 하트비트가 소리를 받아 튼다
    expect(a.played.at(-1)).toBe('transient');
    expect(session.type).toBe('transient');

    a.onended?.();
    expect(session.type).toBe('auto');
    expect(media.playbackState).toBe('none');
    expect(media.metadata).toBeNull();
    setPhoneVoice(false);
  });
});

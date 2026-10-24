// 폰 음성 모드 소리 — 듣던 음악·영상을 멈추지 않게(2026-10-23 사용자 "내비 안내처럼 잠깐 줄였다가 다시").
// iOS 사파리 16.4+ navigator.audioSession.type: 'transient' = 다른 소리를 잠깐 줄이고 끝나면 돌려줌, 'ambient' = 섞어 틈.
// 기본('auto')으로 틀면 미디어 재생으로 잡혀 다른 앱 소리가 끊기고 잠금 화면 '지금 재생'에 올라간다. 없는 브라우저는 그대로 둔다
export type AudioSessionLike = { type: string };
export type DuckType = 'transient' | 'ambient';

export function makeDuck(get: () => AudioSessionLike | undefined) {
  let prev: string | null = null; // 바꾸기 전 값 — 바꿔 둔 동안만 있다
  let n = 0; // 마지막으로 바꾼 번호 — 앞 소리의 늦은 끝이 뒤 소리 도중에 되돌리지 않게
  const set = (s: AudioSessionLike, t: string) => { try { s.type = t; } catch { /* 못 바꾸는 브라우저 — 소리는 그대로 튼다 */ } };
  return {
    /** 틀기 직전에 — 돌려받은 번호를 end 에 */
    begin(t: DuckType): number {
      const s = get();
      if (!s) return 0;
      if (prev === null) prev = s.type;
      set(s, t);
      return ++n;
    },
    /** 끝·실패·멈춤에 — 원래 값으로(번호를 주면 그게 마지막으로 바꾼 것일 때만) */
    end(id?: number) {
      const s = get();
      if (!s || prev === null || (id !== undefined && id !== n)) return;
      set(s, prev);
      prev = null;
    },
  };
}

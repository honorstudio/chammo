// 폰이 '이 폰 연결이 풀렸어요'로 간 까닭(2026-11-13) — 다시 로그인하면 폰 저장소가 지워지고, 맥 기록엔 폰 쪽 판단이 안 남아
// '왜 다시 로그인했나'를 가릴 수 없었다. 처음 본 까닭을 남겨 두고(다시 잇기도 안 지운다), 다시 이은 뒤 맥 기록에 한 줄(phone-diag relink)
export type LostWhy = 'hold' | 'nokeys' | 'relay401' | 'confirm';
type Store = { get: (k: string) => string | null; set: (k: string, v: string | null) => void };

export const LOST_KEY = 'chammo.lost';
const WHYS: LostWhy[] = ['hold', 'nokeys', 'relay401', 'confirm'];

/** 처음 본 까닭만 — '다시 해 보기'가 낸 hold 가 원래 까닭을 덮지 않게 */
export function markLost(s: Store, why: LostWhy, now: number) {
  if (s.get(LOST_KEY)) return;
  s.set(LOST_KEY, JSON.stringify({ why, at: now }));
}

/** 꺼내고 지운다. 깨졌거나 모르는 까닭이면 null */
export function takeLost(s: Store): { why: LostWhy; at: number } | null {
  const raw = s.get(LOST_KEY);
  if (!raw) return null;
  s.set(LOST_KEY, null);
  try {
    const v = JSON.parse(raw) as { why?: unknown; at?: unknown };
    return WHYS.includes(v.why as LostWhy) && typeof v.at === 'number' ? { why: v.why as LostWhy, at: v.at } : null;
  } catch {
    return null;
  }
}

/** 맥 /api/diag 줄 — 낱말=값만 */
export const relinkLine = (m: { why: LostWhy; at: number }, now: number) => `why=${m.why} ago=${Math.max(0, Math.round((now - m.at) / 1000))}`;

/** 브라우저 저장소(개인 정보 보호 모드면 조용히) */
export const lostStore: Store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 막힘 */ } },
};

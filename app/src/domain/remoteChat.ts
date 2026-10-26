// 다른 기기 참모 채팅(ADR 0011) — 그 기기 폰 서버 세션 목록에서 HQ 참모 고르기 + '사람이 방금 쳤나' 판단.
// 보내기(remote_human_say)는 그 기기에 '사람 말(원격)'로 들어가서, 앱 코드가 저절로 보내는 길(다시 보내기 줄 세우기·음성 등)은 막는다
import { pathKey } from './paths';
import { parseAgents } from './session';

export type RemoteAssistant = { id: string; name: string; sessionId: string; state: string };

/** 그 기기 HQ 폴더 세션 중 대화 기록(sessionId)이 있는 것 */
export function remoteAssistants(sessionsJson: string, hqDir: string): RemoteAssistant[] {
  try {
    return parseAgents(sessionsJson, '')
      .filter((s) => !!s.sessionId && pathKey(s.cwd) === pathKey(hqDir))
      .map((s) => ({ id: s.id, name: s.name, sessionId: s.sessionId!, state: s.state }));
  } catch {
    return [];
  }
}

/** 진짜(isTrusted) 키·클릭 뒤 이 시간 안의 보내기만 */
export const TRUST_MS = 1500;
export const sendAllowed = (trustedAt: number, now: number): boolean => trustedAt > 0 && now - trustedAt <= TRUST_MS;

/** 원격 사람 말(그 기기 폰 서버 /api/peer-human)이 든 첫 판 — 공개 v0.3.9 엔 없다 */
export const HUMAN_SAY_MIN = '0.4.0';

/** a < b 인가 — 숫자 세 칸(0.3.10 > 0.3.9), 뒤 꼬리(-beta)는 안 본다. 숫자가 아니면 모른다(false) */
function olderThan(a: string, b: string): boolean {
  const n = (v: string) => v.split(/[-+]/)[0]!.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
  const x = n(a);
  const y = n(b);
  if (x.length < 2 || x.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/** 그 기기 판이 원격 말 걸기 전인가 — 판을 모르면 false(보내 보고 답으로 가린다) */
export const sayTooOld = (version?: string | null) => !!version && olderThan(version, HUMAN_SAY_MIN);

/** 옛 판 폰 서버가 사람 길을 모를 때의 답 — peer 열쇠 길 없음(403)·없는 길(404) */
export const oldSayError = (e: string) => /^(not for a peer key|not found|HTTP 40[34])$/i.test(e.trim());

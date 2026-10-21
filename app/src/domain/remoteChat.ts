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

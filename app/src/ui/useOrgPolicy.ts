// 회사 정책 감지(ADR 0023) — Rust org_policy(정책 파일·doctor)를 켤 때와 30분마다, 백그라운드 세션의 첫 권한 모드(세 번째 겹)를 세션이 바뀔 때 읽는다.
// 돌려주는 값 = 자동 허용을 끄고 사람 카드로 물을까. 못 읽으면 false(지금 그대로)
import { useEffect, useRef, useState } from 'react';
import { orgPolicy, startupModes } from '../data/tauri';
import { blocksAutoAllow, seenDowngrade, type OrgPolicy } from '../domain/orgPolicy';
import type { Session } from '../domain/session';

const POLICY_MS = 30 * 60_000;

export function useOrgPolicy(sessions: Session[]): { policy: OrgPolicy | null; blocked: boolean } {
  const [policy, setPolicy] = useState<OrgPolicy | null>(null);
  const [modes, setModes] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const load = () => void orgPolicy().then(setPolicy).catch(() => {});
    load();
    const t = setInterval(load, POLICY_MS);
    return () => clearInterval(t);
  }, []);
  // 첫 권한 모드는 안 바뀐다 — 찾은 것만 기억하고, 못 찾은 건(막 뜬 세션은 아직 줄이 없다) 다음에 다시
  const want = sessions.filter((s) => s.kind === 'background' && s.sessionId && !(s.sessionId in modes) && !asked.current.has(s.sessionId)).map((s) => s.sessionId!);
  const key = want.join(',');
  useEffect(() => {
    if (!key) return;
    const ids = key.split(',');
    ids.forEach((id) => asked.current.add(id));
    void startupModes(ids)
      .then((m) => setModes((old) => ({ ...old, ...m })))
      .catch(() => {})
      .finally(() => setTimeout(() => ids.forEach((id) => asked.current.delete(id)), 15_000));
  }, [key]);
  const seen = seenDowngrade(sessions.map((s) => ({ kind: s.kind, startedAt: s.startedAt, mode: s.sessionId ? modes[s.sessionId] : undefined })));
  return { policy, blocked: blocksAutoAllow(policy, seen) };
}

// 로그인 풀림 실행 — 판단은 domain/login.loginStep. 세션 기록이 바뀔 때마다·맥 로그인 상태를 잴 때마다 한 번 돈다.
// 재기(Rust login_probe = auth status + 로그인 칸 고친 시각)는 멈춘 세션이 있으면 15초마다, 없으면 10분마다(claude 를 띄우는 일이라 아낀다).
// 할 일: 이어서(고쳐진 걸 본 뒤만)·갱신 겹침 뒤 이어서·다시 띄우기(멈춰 있는지 그 자리에서 다시 보고) → '로그인 필요'가 새로 생기면 알림·음성 한 번
// → 폰이 읽게 <데이터>/login.json. 카드는 ui/LoginCard
import { useEffect, useRef, useState } from 'react';
import { listSessionsRaw, loginProbe, loginSave, resumeSession, sendToSession, speak } from '../data/tauri';
import { readAuto } from '../domain/accountAuto';
import type { AccountsView } from '../domain/accounts';
import { emptyLogin, loggedOutSeen, loginStep, okAtOf, readProbe, resumedMsg, retryMsg, stalledOf, type LoginNeed } from '../domain/login';
import { tr } from '../i18n';
import { notifyOnce } from './notifier';
import type { SessionActivity } from './TaskPanel';

const FAST_MS = 15_000;
const SLOW_MS = 10 * 60_000;

/** agents --json 한 줄 — 다시 띄우기 직전 '정말 멈춰 있나'만 본다(낡은 목록으로 respawn 하면 도는 턴이 끊긴다) */
async function stillStopped(id: string): Promise<boolean> {
  try {
    const rows = JSON.parse(await listSessionsRaw()) as { id?: string; status?: string; state?: string }[];
    const r = rows.find((x) => x.id === id);
    return !!r && r.status !== 'busy' && r.state !== 'working';
  } catch {
    return false;
  }
}

export function useLogin(acts: SessionActivity[], accounts: AccountsView | null, voice: boolean): { need: LoginNeed | null } {
  const mem = useRef(emptyLogin());
  const probe = useRef<{ loggedIn: boolean | null; credAt: number | null; at: number; falses: number }>({ loggedIn: null, credAt: null, at: 0, falses: 0 });
  const [need, setNeed] = useState<LoginNeed | null>(null);
  const [tick, setTick] = useState(0);
  const saved = useRef<string | null>(null);
  const shownSince = useRef<number | null>(null);
  const busy = useRef(false);
  const actsRef = useRef(acts);
  actsRef.current = acts;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const stalled = stalledOf(acts.map((a) => ({ session: a.session, activity: a.activity })));
  // 한 번 false 를 봤으면(아직 모름) 빨리 다시 잰다 — 두 번째로 확인
  const hot = stalled.length > 0 || need !== null || probe.current.falses > 0;

  // 재기 — 멈춘 세션이 생기면 바로 한 번, 그 뒤 15초마다
  useEffect(() => {
    let alive = true;
    const once = async () => {
      const p = readProbe(await loginProbe().catch(() => null));
      if (!alive) return;
      const seen = loggedOutSeen(probe.current.falses, p.loggedIn);
      probe.current = { credAt: p.credAt, loggedIn: seen.loggedIn, falses: seen.falses, at: Date.now() };
      setTick((t) => t + 1);
    };
    void once();
    const t = setInterval(() => void once(), hot ? FAST_MS : SLOW_MS);
    return () => { alive = false; clearInterval(t); };
  }, [hot]);

  const auto = readAuto(accounts?.auto);
  const slot = accounts?.active ? auto.slots[accounts.active] : undefined;
  const liveAuthAt = slot?.authAt ?? null;
  const key = `${stalled.map((x) => `${x.session}:${x.ts}`).join('|')}#${probe.current.at}#${liveAuthAt}#${okAtOf(acts)}#${tick}`;

  useEffect(() => {
    if (busy.current) return;
    const now = Date.now();
    const plan = loginStep(mem.current, {
      now,
      stalled,
      loginAt: probe.current.credAt,
      loggedIn: probe.current.loggedIn,
      liveAuthAt,
      okAt: okAtOf(actsRef.current),
    });
    mem.current = plan.mem;
    setNeed((prev) => (JSON.stringify(prev) === JSON.stringify(plan.need) ? prev : plan.need));
    // 새로 생긴 '로그인 필요'만 알린다 — 세션이 늘어도 같은 카드
    if (plan.need && shownSince.current === null) {
      const who = plan.need.sessions.length ? plan.need.sessions.join(', ') : tr('이 맥', 'this Mac');
      notifyOnce({ kind: 'login', session: 'login', orch: false, title: tr('Claude 로그인이 풀렸어요', 'Claude sign-in expired'), body: tr(`멈춘 곳: ${who} — 결정 대기함에서 로그인`, `Stopped: ${who} — sign in from Decisions`) });
      if (voiceRef.current) void speak(tr('Claude 로그인이 풀렸어. 결정 대기함이나 폰에서 로그인해 줘', 'Claude sign-in expired. Sign in from Decisions or your phone')).catch(() => {});
    }
    shownSince.current = plan.need ? plan.need.since : null;
    const file = JSON.stringify(plan.need ? { ...plan.need, at: now } : null);
    const sig = JSON.stringify(plan.need);
    if (sig !== saved.current) {
      saved.current = sig;
      void loginSave(file).catch(() => { saved.current = null; });
    }
    if (!plan.nudge.length && !plan.retry.length && !plan.respawn.length) return;
    busy.current = true;
    void (async () => {
      try {
        for (const id of plan.nudge) await sendToSession(id, resumedMsg()).catch(() => {});
        for (const id of plan.retry) await sendToSession(id, retryMsg()).catch(() => {});
        for (const id of plan.respawn) {
          const s = actsRef.current.find((a) => a.session.id === id)?.session;
          if (!s?.sessionId || !(await stillStopped(id))) continue;
          await resumeSession(s.cwd, s.sessionId, s.id).then(() => sendToSession(s.id, resumedMsg())).catch(() => {});
        }
      } finally {
        busy.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { need };
}

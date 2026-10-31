// 로그인 풀림 실행 — 판단은 domain/login.loginStep. 세션 기록이 바뀔 때마다·맥 로그인 상태를 잴 때마다 한 번 돈다.
// 재기(Rust login_probe = auth status + 로그인 칸 고친 시각)는 멈춘 세션이 있으면 15초마다, 없으면 10분마다(claude 를 띄우는 일이라 아낀다).
// 할 일: 이어서(고쳐진 걸 본 뒤만)·갱신 겹침 뒤 이어서·다시 띄우기(멈춰 있는지 그 자리에서 다시 보고) → '로그인 필요'가 새로 생기면 알림·음성 한 번
// → 폰이 읽게 <데이터>/login.json. 카드는 ui/LoginCard
// 지금 로그인 미리 갱신(Rust login_keep) 상태는 1분마다 따로 읽는다(파일 하나 — claude 를 안 띄운다). late·dead 면 세션이 멈추기 전에 같은 카드
// 약관 동의 필요(2026-10-28)는 로그인 카드와 따로 계정마다 카드(terms) — [다시 시도]는 데스크톱·폰 어디서 눌러도 Rust 파일 하나(재기가 termsRetryAt 으로 읽는다).
// 새 다시 시도를 보면 계정 풀 약관 막힘을 풀고(clearTerms — 이 화면 카드는 그 칸만, 폰은 아직 전부) 멈춘 세션에 이어서 한 번.
// [닫기]는 그 카드만 숨긴다(막힘은 그대로 — 계정·멈춘 곳이 바뀌면 다시 뜬다)
import { useEffect, useRef, useState } from 'react';
import { accountsApi, listSessionsRaw, loginKeepState, loginProbe, loginSave, loginTermsRetry, resumeSession, sendToSession, speak } from '../data/tauri';
import { changedKeys, clearTerms, readAuto } from '../domain/accountAuto';
import { ACCOUNTS_CHANGED, type AccountsView } from '../domain/accounts';
import { emptyLogin, loggedOutSeen, loginStep, SETTLE_MS, needText, okAtOf, readKeep, readProbe, resumedMsg, retryMsg, stalledOf, termsCards, termsKey, termsResumedMsg, termsText, type Keep, type LoginNeed, type TermsCard } from '../domain/login';
import { tr } from '../i18n';
import { notifyOnce } from './notifier';
import type { SessionActivity } from './TaskPanel';

const FAST_MS = 15_000;
const SLOW_MS = 10 * 60_000;
const KEEP_MS = 60_000;

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

/** 계정 풀 약관 막힘 풀기(id 면 그 칸만) — 새로 읽어 그 키만 저장(자동 전환과 겹쳐도 남의 칸을 옛 값으로 안 덮게) */
async function unblock(id?: string) {
  try {
    const v = await accountsApi.view();
    const before = readAuto(v.auto);
    const ch = changedKeys(before, clearTerms(before, Date.now(), id));
    if (!Object.keys(ch).length) return;
    await accountsApi.autoPatch(ch);
    window.dispatchEvent(new Event(ACCOUNTS_CHANGED));
  } catch { /* 계정 칸이 없거나 저장 실패 — 다음 다시 시도에 */ }
}

export function useLogin(acts: SessionActivity[], accounts: AccountsView | null, voice: boolean): { need: LoginNeed | null; terms: TermsCard[]; retryTerms: (id?: string) => void; closeTerms: (c: TermsCard) => void; missing: boolean } {
  const mem = useRef(emptyLogin());
  const probe = useRef<{ loggedIn: boolean | null; credAt: number | null; at: number; falses: number; termsRetryAt: number | null }>({ loggedIn: null, credAt: null, at: 0, falses: 0, termsRetryAt: null });
  const [need, setNeed] = useState<LoginNeed | null>(null);
  /** claude 가 그 자리에서 안 돈다(Rust probe_auth) — 로그인 카드 대신 다시 설치 카드 */
  const [missing, setMissing] = useState(false);
  const [terms, setTerms] = useState<TermsCard[]>([]);
  /** 이 화면에서 누른 다시 시도 — 재기를 기다리지 않고 바로 카드를 내린다 */
  const [localRetry, setLocalRetry] = useState<number | null>(null);
  /** 닫은 카드(termsKey) — 이 화면에서만 숨긴다 */
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  /** 계정 풀 약관 막힘을 푼 다시 시도 시각 — 같은 누름으로 두 번 안 푼다 */
  const cleared = useRef<number | null>(null);
  const termsShown = useRef(new Set<string>());
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const [tick, setTick] = useState(0);
  const [keep, setKeep] = useState<Keep | null>(null);
  const saved = useRef<string | null>(null);
  const shownSince = useRef<number | null>(null);
  const busy = useRef(false);
  const actsRef = useRef(acts);
  actsRef.current = acts;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const stalled = stalledOf(acts.map((a) => ({ session: a.session, activity: a.activity })));
  // 한 번 false 를 봤으면(아직 모름) 빨리 다시 잰다 — 두 번째로 확인
  const hot = stalled.length > 0 || need !== null || probe.current.falses > 0 || missing; // 다시 설치 뒤 카드가 빨리 내려가게

  // 재기 — 멈춘 세션이 생기면 바로 한 번, 그 뒤 15초마다
  useEffect(() => {
    let alive = true;
    const once = async () => {
      const p = readProbe(await loginProbe().catch(() => null));
      if (!alive) return;
      const seen = loggedOutSeen(probe.current.falses, p.loggedIn);
      probe.current = { credAt: p.credAt, loggedIn: seen.loggedIn, falses: seen.falses, at: Date.now(), termsRetryAt: p.termsRetryAt ?? null };
      setMissing(!!p.claudeMissing);
      setTick((t) => t + 1);
    };
    void once();
    const t = setInterval(() => void once(), hot ? FAST_MS : SLOW_MS);
    return () => { alive = false; clearInterval(t); };
  }, [hot]);

  // 미리 갱신 상태 — 1분마다(Rust 도 1분마다 고친다)
  useEffect(() => {
    let alive = true;
    const once = () => { void loginKeepState().then((v) => { if (alive) setKeep(readKeep(v)); }, () => {}); };
    once();
    const t = setInterval(once, KEEP_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const auto = readAuto(accounts?.auto);
  const slot = accounts?.active ? auto.slots[accounts.active] : undefined;
  const liveAuthAt = slot?.authAt ?? null;
  const termsRetryAt = Math.max(probe.current.termsRetryAt ?? 0, localRetry ?? 0) || null;
  const termsBlocked = accounts?.accounts.filter((a) => auto.slots[a.id]?.why === 'terms').map((a) => a.id).join(',') ?? '';
  const key = `${stalled.map((x) => `${x.session}:${x.ts}`).join('|')}#${probe.current.at}#${liveAuthAt}#${okAtOf(acts)}#${tick}#${keep}#${termsRetryAt}#${termsBlocked}#${accounts?.active}`;

  // 새 다시 시도(데스크톱·폰) — 계정 풀 약관 막힘을 푼다. 아직 동의 전이면 다음 오류에 또 막힌다
  useEffect(() => {
    if (termsRetryAt === null || cleared.current === termsRetryAt) return;
    const first = cleared.current === null;
    cleared.current = termsRetryAt;
    if (first && Date.now() - termsRetryAt > 60_000) return; // 앱을 새로 켰을 때 옛 누름으로 풀지 않는다
    if (termsRetryAt === localRetry) return; // 이 화면 카드 — 누를 때 그 칸만 풀었다
    void unblock(); // 폰 다시 시도 — 어느 카드인지 안 실려 와서 약관 막힘 전부
  }, [termsRetryAt]);

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
      keep,
      termsRetryAt,
    });
    mem.current = plan.mem;
    setNeed((prev) => (JSON.stringify(prev) === JSON.stringify(plan.need) ? prev : plan.need));
    const cards = termsCards(plan.terms, accountsRef.current);
    setTerms((prev) => (JSON.stringify(prev) === JSON.stringify(cards) ? prev : cards));
    // 새로 생긴 약관 카드만 알린다 — 계정마다 한 번(카드가 내려가면 잊는다)
    const ids = new Set(cards.map((c) => c.id));
    for (const c of cards) {
      if (termsShown.current.has(c.id)) continue;
      const t = termsText(c);
      notifyOnce({ kind: 'login', session: `terms:${c.id}`, orch: false, title: t.title, body: tr('결정 대기함 카드에서 claude.ai 를 열어 동의해 주세요', 'Open claude.ai from the card in Decisions to accept') });
      if (voiceRef.current) void speak(tr('Claude 계정 하나가 새 약관 동의가 필요해. 결정 대기함 카드에서 claude.ai 를 열어 동의해 줘', 'A Claude account needs to accept the new terms. Open claude.ai from the card in Decisions')).catch(() => {});
    }
    termsShown.current = ids;
    // 새로 생긴 '로그인 필요'만 알린다 — 세션이 늘어도 같은 카드
    if (plan.need && shownSince.current === null) {
      const t = needText(plan.need);
      const soon = plan.need.keep === 'late' && !plan.need.sessions.length;
      notifyOnce({ kind: 'login', session: 'login', orch: false, title: t.title, body: tr(`${t.where} — 결정 대기함에서 로그인`, `${t.where} — sign in from Decisions`) });
      if (voiceRef.current) void speak(soon ? tr('Claude 로그인이 곧 끝나. 결정 대기함이나 폰에서 한 번 로그인해 줘', 'Claude sign-in ends soon. Sign in once from Decisions or your phone') : tr('Claude 로그인이 풀렸어. 결정 대기함이나 폰에서 로그인해 줘', 'Claude sign-in expired. Sign in from Decisions or your phone')).catch(() => {});
    }
    shownSince.current = plan.need ? plan.need.since : null;
    // 폰 /api/login — 로그인 판단 + 약관 카드(있을 때만 terms)
    const file = JSON.stringify(plan.need || cards.length ? { ...(plan.need ?? {}), ...(cards.length ? { terms: cards } : {}), at: now } : null);
    const sig = JSON.stringify([plan.need, cards]);
    if (sig !== saved.current) {
      saved.current = sig;
      void loginSave(file).catch(() => { saved.current = null; });
    }
    if (!plan.nudge.length && !plan.retry.length && !plan.respawn.length && !plan.termsNudge.length) return;
    busy.current = true;
    void (async () => {
      try {
        for (const id of plan.nudge) await sendToSession(id, resumedMsg()).catch(() => {});
        for (const id of plan.termsNudge) await sendToSession(id, termsResumedMsg()).catch(() => {});
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

  const retryTerms = (id?: string) => {
    const at = Date.now();
    void unblock(id);
    setLocalRetry(at);
    void loginTermsRetry(at).catch(() => {});
    window.setTimeout(() => setTick((t) => t + 1), SETTLE_MS + 200); // 이어서는 누른 뒤 SETTLE_MS — 다음 재기(15초)까지 안 기다리게
  };
  const closeTerms = (c: TermsCard) => setClosed((p) => new Set([...p, termsKey(c)]));
  return { need, terms: terms.filter((c) => !closed.has(termsKey(c))), retryTerms, closeTerms, missing };
}

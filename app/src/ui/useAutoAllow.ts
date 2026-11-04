// 도구 권한 창 자동 허용 — 사용자 방침 2026-09-27 "권한은 항상 다 준다".
// waitingFor=permission prompt 인 세션만. 화면을 읽어 Allow 줄을 이름으로 찾고(domain/autoAllow) 키를 넣은 뒤, 풀렸는지 확인해 기록한다.
// 선택지 질문(input needed)·비밀번호·2FA·결제 창은 건드리지 않는다 — 결정 대기함에 그대로 남는다
import { useEffect, useRef } from 'react';
import { listSessionsRaw, logAutoAllow, permCardClose, permCardOpen, sendKeys, sessionScreen } from '../data/tauri';
import { notifyOnce } from './notifier';
import { leftWindow, pickAllow, retryAfter, skipPlan, type AllowOutcome } from '../domain/autoAllow';
import { parseAgents, type Session } from '../domain/session';
import { tr } from '../i18n';

const CHECK_MS = 4_000;    // 누른 뒤 풀렸는지 보기까지

/** 자동 허용 대상 — 선택지 질문(input needed)은 아니다 */
const AUTO = ['permission prompt', 'startup prompt'];

/** 지금 누르는 중인 세션 — 훅이 둘 돌아도(개발판 다시 읽기 등) 같은 창을 두 번 누르지 않게. 두 번 누르면 아래 화살표가 겹쳐 '아니오'에 닿았다(2026-10-01 실측) */
const inFlight = new Set<string>();
/** 건너뛴 창을 알린 세션 → 그 창 글. 같은 창은 한 번만 알리고 기록한다(1분마다 다시 보며 기록만 쌓였다 — 2026-10-01 250번, 아무도 몰랐다). 세션이 창을 벗어나면 지운다 */
const toldSkip = new Map<string, string>();
/** 화면을 연달아 못 읽은 횟수 — 커서 못 찾음(한 번은 덜 그려진 화면일 수 있어 조용히 다시)·붙는 중 전환 화면(30초까지 조용히)을 따로 센다 */
const misses = new Map<string, number>();
const soons = new Map<string, number>();
/** 회사 정책 아래 사람 카드를 띄운 세션 → 카드 id(ADR 0023). 창을 벗어나면 카드를 거둔다 */
const carded = new Map<string, string>();
/** 건너뛴 창 — 무슨 창이었는지 기록에 남긴다(마지막 구분선 아래 12줄, 300자). 왜 건너뛰었는지 나중에 볼 수 없었다 */
const promptTail = (screen: string) => {
  const all = screen.split('\n');
  let from = 0;
  all.forEach((l, i) => { if (/─{4,}/.test(l)) from = i + 1; });
  return all.slice(from).map((l) => l.trim()).filter(Boolean).slice(0, 12).join(' / ').slice(0, 300);
};

const whereOf = (s: Session) => (s.workspace ? `${s.project} / ${s.workspace}` : s.project);

/** policyBlocked = 회사 정책으로 바이패스가 막힌 기기(useOrgPolicy) — 그땐 누르지 않고 사람 카드로. false 면 예전과 똑같다 */
export function useAutoAllow(sessions: Session[], devRoot: string | undefined, onLog: () => void, policyBlocked = false) {
  /** 세션 id → 다시 봐도 되는 때 (domain/autoAllow retryAfter) */
  const next = useRef(new Map<string, number>());
  const busy = useRef(false);
  useEffect(() => {
    // 창을 벗어난 세션은 붙잡은 걸 놓는다 — 다음 창은 바로 본다(같은 창은 벗어날 때까지 다시 안 본다, 2026-10-11 perf 9번)
    for (const id of leftWindow(next.current.keys(), sessions, AUTO)) {
      next.current.delete(id);
      toldSkip.delete(id);
      misses.delete(id);
      soons.delete(id);
      if (carded.delete(id)) void permCardClose(id).catch(() => {});
    }
    if (busy.current || !devRoot) return;
    const now = Date.now();
    const s = sessions.find((x) => x.kind === 'background' && AUTO.includes(x.waitingFor ?? '') && now >= (next.current.get(x.id) ?? 0) && !inFlight.has(x.id));
    if (!s) return;
    busy.current = true;
    inFlight.add(s.id);
    const done = (o: AllowOutcome) => next.current.set(s.id, Date.now() + retryAfter(o));
    done('failed'); // 도는 동안은 다시 안 잡게
    const log = (ev: object) => logAutoAllow({ ts: new Date().toISOString(), where: whereOf(s), ...ev }).then(onLog).catch(() => {});
    void (async () => {
      try {
        if (policyBlocked) {
          // 회사 정책 — 화면을 읽어 사람 카드(결정 대기함·채팅·폰). 같은 창이면 같은 카드, 누르는 건 사람이 고른 뒤 Rust 가 같은 창인지 보고
          const id = await permCardOpen(s.id, s.cwd);
          if (!id) {
            // 카드로 못 읽는 창(번호 줄이 없는 창 등) — 조용히 두지 않고 예전처럼 '직접 골라야 하는 창'으로 알린다(채팅 선택지 버튼)
            const why = tr('선택지 커서를 못 찾았어', "Couldn't find the option cursor");
            const plan = skipPlan({ skip: why }, misses.get(s.id) ?? 0);
            misses.set(s.id, (misses.get(s.id) ?? 0) + 1);
            done(plan.outcome);
            if (plan.tell && toldSkip.get(s.id) !== why) {
              toldSkip.set(s.id, why);
              notifyOnce({ kind: 'allowFail', session: s.id, orch: false, title: tr(`${whereOf(s)} — 직접 골라야 하는 창`, `${whereOf(s)} — needs your choice`), body: tr(`${why} — 그 세션 채팅을 열면 버튼으로 고를 수 있어`, `${why} — open that session's chat to choose`) });
            }
            return;
          }
          done('carded');
          misses.delete(s.id);
          if (carded.get(s.id) !== id) {
            carded.set(s.id, id);
            await log({ result: tr('회사 정책으로 직접 확인 요청', 'Asked a person, per company policy'), card: id });
          }
          return;
        }
        const screen = await sessionScreen(s.id);
        const pick = pickAllow(screen);
        if ('skip' in pick) {
          const count = pick.soon ? soons : misses;
          const plan = skipPlan(pick, count.get(s.id) ?? 0);
          done(plan.outcome);
          if (!pick.hold) count.set(s.id, (count.get(s.id) ?? 0) + 1);
          // 붙는 중 화면·처음 못 읽은 화면은 조용히 곧 다시 — '직접 골라야 하는 창' 헛알림이 사흘에 26번 나갔다(2026-10-11 bug-hunt)
          if (!plan.tell) return;
          const tail = promptTail(screen);
          // 같은 창을 다시 본 것(안전망 10분·커서 못 찾음 1분)이면 기록·알림 없이 — 기록만 393줄 쌓였다
          if (toldSkip.get(s.id) === tail) return;
          await log({ result: tr(`건너뜀 — ${pick.skip}`, `Skipped — ${pick.skip}`), prompt: tail });
          // 사람이 골라야 하는 창 — 알린다. 그 세션 채팅을 열면 선택지 버튼으로 고를 수 있다(ChatDialog)
          toldSkip.set(s.id, tail);
          notifyOnce({ kind: 'allowFail', session: s.id, orch: false, title: tr(`${whereOf(s)} — 직접 골라야 하는 창`, `${whereOf(s)} — needs your choice`), body: tr(`${pick.skip} — 그 세션 채팅을 열면 버튼으로 고를 수 있어`, `${pick.skip} — open that session's chat to choose`) });
          return;
        }
        await sendKeys(s.id, pick.keys);
        await new Promise((r) => setTimeout(r, CHECK_MS));
        const after = parseAgents(await listSessionsRaw(true), devRoot).find((x) => x.id === s.id); // 새로 — 같이 쓰는 목록이면 누르기 전 모습일 수 있다
        const ok = !after || !AUTO.includes(after.waitingFor ?? '');
        done(ok ? 'allowed' : 'stillOpen');
        if (ok) { toldSkip.delete(s.id); misses.delete(s.id); soons.delete(s.id); }
        await log({ option: pick.option, result: ok ? tr('허용됨', 'Allowed') : tr('풀리지 않음 — 직접 봐줘', 'Still open — please check it') });
        if (!ok) notifyOnce({ kind: 'allowFail', session: s.id, orch: false, title: tr(`${whereOf(s)} 권한 창 자동 허용 실패`, `${whereOf(s)}: auto-allow failed`), body: tr(`"${pick.option}" 을 눌렀는데 창이 그대로야 — 열어서 봐줘`, `Pressed "${pick.option}" but the prompt is still there — open it and check`) });
      } catch (e: unknown) {
        done('failed');
        await log({ result: tr(`실패 — ${String(e)}`, `Failed — ${String(e)}`) });
      } finally {
        busy.current = false;
        inFlight.delete(s.id);
      }
    })();
  }, [sessions, devRoot, onLog, policyBlocked]);
}

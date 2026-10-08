// 계정 자동 전환 실행 — 판단은 domain/accountAuto.step. App 이 계정 보기를 15초마다 새로 읽을 때마다 한 번 돈다.
// 순서: 계정 보기를 새로 읽음(App 이 넘긴 건 바뀌기 전 것일 수 있다 — 옛 상태로 판단하면 새 계정을 옛 값으로 막는다) → 판단
// → (바꿀 거면) 바로 앞에서 한 번 더 읽어 그새 사람이 바꿨으면 이번엔 안 함 → 키체인 바꾸기 → 그다음에 멈춘 세션에 '계속해'
// (순서가 바뀌면 옛 계정으로 다시 부딪힌다) → 상태 저장 → 화면 갱신 신호. 토큰은 여기 안 온다(Rust 가 키체인에서 바로 바꿔 끼운다)
import { useEffect, useRef } from 'react';
import { accountsApi, sendToSession, speak } from '../data/tauri';
import { accountError, ACCOUNTS_CHANGED, type AccountsView } from '../domain/accounts';
import { afterSwitch, applyApi, changedKeys, fmtUntil, markNudged, migrate, readAuto, step, stuckOf } from '../domain/accountAuto';
import type { SessionActivity } from './TaskPanel';
import { tr } from '../i18n';
import { notifyOnce } from './notifier';

/** 자동 바꾸기가 실패하면(키체인 잠김 등) 이만큼 쉰다 */
const BACKOFF_MS = 5 * 60_000;
/** 사용량 주소 묻는 간격 — 남의 서버라 지금 로그인은 1분, 보관 칸은 5분보다 촘촘하게 안 묻는다. 429·실패면 5분 쉰다 */
const LIVE_EVERY_MS = 60_000;
const SLOTS_EVERY_MS = 5 * 60_000;

export function useAccountAuto(accounts: AccountsView | null, acts: SessionActivity[], voice: boolean) {
  const busy = useRef(false);
  const restUntil = useRef(0);
  const asked = useRef({ live: 0, slots: 0, restUntil: 0 });
  const lastActive = useRef<string | null>(null);
  const actsRef = useRef(acts);
  actsRef.current = acts;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    // accounts 는 '돌 때'만 알려 준다(15초마다 새로 온다) — 판단은 새로 읽은 걸로
    if (!accounts || !accounts.accounts.length || busy.current || Date.now() < restUntil.current) return;
    busy.current = true;
    void (async () => {
      let switched = false; // = 화면 갱신 신호를 보낼까
      try {
        const v = await accountsApi.view();
        if (!v.accounts.length) return;
        let before = readAuto(v.auto);
        const usage = await accountsApi.usageAt().catch(() => null);
        const ids = v.accounts.map((a) => a.id);
        // 계정 토큰으로 바로 묻기(주인이 확실한 값) — 상태줄 값은 지문으로 가리는 보조
        let fresh0 = migrate(before); // 옛 판 지우기 → 묻기 → 판단 순서(거꾸로면 방금 물은 값이 지워진다)
        const t = Date.now(), q = asked.current;
        // 지금 칸이 바뀌었으면(설정에서 손으로 등) 바로 묻는다 — 막대가 새 계정 값을 기다리지 않게
        const wantLive = t - q.live >= LIVE_EVERY_MS || v.active !== lastActive.current, wantSlots = t - q.slots >= SLOTS_EVERY_MS;
        lastActive.current = v.active;
        if ((wantLive || wantSlots) && t >= q.restUntil) {
          if (wantLive) q.live = t;
          if (wantSlots) q.slots = t;
          const got = await accountsApi.usage(wantSlots ? ids.filter((id) => id !== v.active) : [], wantLive).catch(() => []);
          if (got.some((g) => g.status === 'rate' || g.status === 'fail')) q.restUntil = t + BACKOFF_MS;
          fresh0 = applyApi(fresh0, got, ids, t);
        }
        const plan = step(fresh0, { now: Date.now(), ids, active: v.active, usage: usage?.json ? usage : null, stuck: stuckOf(actsRef.current) });
        let state = plan.state;
        const name = (id: string | null) => v.accounts.find((a) => a.id === id)?.name ?? '';
        if (plan.switchTo) {
          // 그새 사람이 설정에서 바꿨거나 자동을 껐으면 이번엔 안 한다
          const fresh = await accountsApi.view();
          if (fresh.active !== v.active || JSON.stringify(fresh.auto ?? null) !== JSON.stringify(v.auto ?? null)) return;
          // 막힘·바꾼 시각을 바꾸기 '전에' 저장한다 — 바꾸기가 실패해도 이 기록은 해가 없다(돌아오기만 잠깐 늦다)
          state = afterSwitch(state, Date.now());
          await accountsApi.autoPatch(changedKeys(before, state));
          before = state;
          try {
            await accountsApi.switchTo(plan.switchTo);
          } catch (e: unknown) {
            restUntil.current = Date.now() + BACKOFF_MS;
            notifyOnce({ kind: 'accounts', session: 'accounts', orch: false, title: tr('계정 자동 전환 실패', 'Account auto-switch failed'), body: accountError(String(e)) });
            return;
          }
          switched = true;
          asked.current.live = 0; // 다음 차례(화면 갱신 신호로 바로 온다)에 새 계정 사용량을 바로 묻는다
          // 고정한 계정이 진짜 다 차서 고정이 풀렸다 — 사람이 일부러 고른 거라 한 줄 알린다
          if (plan.unpinned) notifyOnce({ kind: 'accounts', session: 'accounts-unpinned', orch: false, title: tr('고정 계정이 다 차서 넘겼어', 'Pinned account used up'), body: tr(`${name(v.active)} → ${name(plan.switchTo)} · 고정은 풀렸어`, `${name(v.active)} → ${name(plan.switchTo)} · unpinned`) });
          if (voiceRef.current && plan.why !== 'back') void speak(tr(`${name(v.active)} 계정이 다 차서 ${name(plan.switchTo)} 계정으로 넘겼어`, `${name(v.active)} is used up — switched to ${name(plan.switchTo)}`)).catch(() => {});
        }
        // 키체인을 바꾼 다음에 깨운다. 못 보낸 세션은 표시하지 않아 다음 차례에 다시
        const sent: string[] = [];
        for (const id of plan.nudge) {
          try {
            await sendToSession(id, tr('계속해', 'Continue'));
            sent.push(id);
          } catch { /* 다음 차례에 */ }
        }
        if (sent.length) state = markNudged(state, sent, Date.now());
        if (plan.allOut?.notify) {
          const when = fmtUntil(plan.allOut.until, Date.now());
          notifyOnce({ kind: 'accounts', session: 'accounts-all-out', orch: false, title: tr('계정이 다 찼어', 'All accounts are used up'), body: tr(`가장 먼저 풀리는 때: ${when}`, `First to reopen: ${when}`) });
          if (voiceRef.current) void speak(tr(`계정이 다 찼어. ${when}에 풀려`, `All accounts are used up. First reopens at ${when}`)).catch(() => {});
        }
        const ch = changedKeys(before, state);
        if (Object.keys(ch).length) {
          await accountsApi.autoPatch(ch);
          switched = true; // 막대·설정 칸이 새 값을 바로 읽게(바뀐 게 없으면 신호도 없다 — 되풀이 안 됨)
        }
      } catch {
        // 계정 보기·저장 실패 — 다음 차례에 다시
      } finally {
        busy.current = false;
        if (switched) window.dispatchEvent(new Event(ACCOUNTS_CHANGED)); // 상태 저장까지 끝난 뒤에 — 위 막대가 새로 읽는다
      }
    })();
  }, [accounts]);
}

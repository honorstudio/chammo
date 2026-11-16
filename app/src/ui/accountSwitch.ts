// 사람이 고른 계정 = 고정(자동 전환은 그 계정이 다 찰 때 다시) — 설정 '계정' 칸과 위 막대 계정 칩 팝오버가 같은 길로 바꾼다.
// 막힌 칸은 줄의 pick 대로(2026-11-13): 로그인 필요 = 바꾸지 않고 그 계정 로그인(그동안 자동 전환 쉼), 약관 = 그 칸 약관 막힘을 풀고 바꾸기
import { useEffect, useRef, useState } from 'react';
import { accountsApi } from '../data/tauri';
import { clearAuth, clearTerms, pinPatch, readAuto } from '../domain/accountAuto';
import { ACCOUNTS_CHANGED, holdStep, LOGIN_HOLD_MS, type AccountsView, type LoginHold, type RowPick } from '../domain/accounts';

export async function pinActive(v: AccountsView): Promise<AccountsView> {
  return v.active ? accountsApi.autoPatch(pinPatch(v.active, Date.now())) : v;
}

export async function switchPinned(id: string): Promise<AccountsView> {
  return pinActive(await accountsApi.switchTo(id));
}

/** 줄을 눌러 바꾸기 — 약관 막힌 칸은 그 칸 약관 막힘을 먼저 푼다(막힌 채 바꾸면 다음 자동 전환 차례가 첫 칸으로 되돌린다). login 은 startLogin */
export async function pickSwitch(id: string, pick: Exclude<RowPick, 'login'>): Promise<AccountsView> {
  if (pick === 'terms') await accountsApi.autoPatch({ slots: clearTerms(readAuto((await accountsApi.view()).auto), Date.now(), id).slots });
  return switchPinned(id);
}

/** 앱 하나에 하나 — 팝오버·설정 창이 닫혀도 남는다(자동 전환이 이걸 보고 쉬고, 로그인이 끝나면 대신 마무리한다) */
let hold: LoginHold | null = null;
let finishing: Promise<void> | null = null;

/** 그 계정으로 로그인 시작 — 지금 로그인이 칸 계정이면 그 칸에 먼저 보관(쓰다 갱신된 토큰을 잃지 않게, 칸에 없는 로그인은 안 담는다), 그리고 자동 전환을 쉰다 */
export async function startLogin(id: string): Promise<AccountsView> {
  const v = await accountsApi.view();
  const out = v.active ? await accountsApi.capture() : v;
  hold = { id, until: Date.now() + LOGIN_HOLD_MS, seenAt: 0 };
  return out;
}

/** 지금 쉬게 한 계정(상한은 loginTick 이 본다) */
export const loginHeld = (): string | null => hold?.id ?? null;

/** 한 차례 — 로그인이 그 계정이 된 게 이어지면 그 칸 로그인 막힘을 풀고(clearAuth) 바꾸기+고정, 쉬기를 푼다.
 *  사용량 주소가 쉬는 중이면 자동 전환이 막힘을 못 풀어, 안 풀고 고정하면 다음 차례에 첫 칸으로 되돌렸다. 팝오버와 자동 전환 둘 다 부른다 — 한 번만 돈다 */
export async function loginTick(v: AccountsView, now = Date.now()): Promise<'none' | 'wait' | 'done' | 'expired'> {
  if (finishing) {
    await finishing.catch(() => {});
    return 'wait';
  }
  const s = holdStep(hold, v.active, now);
  hold = s.hold;
  if (s.act !== 'finish') return s.act;
  const id = s.hold!.id;
  const run = (async () => {
    try {
      const a = readAuto((await accountsApi.view()).auto), c = clearAuth(a, id, Date.now());
      if (c !== a) await accountsApi.autoPatch({ slots: c.slots });
      await switchPinned(id);
    } finally {
      hold = null;
      finishing = null;
      window.dispatchEvent(new Event(ACCOUNTS_CHANGED));
    }
  })();
  finishing = run;
  await run;
  return 'done';
}

/** 창 안 로그인 터미널을 띄운 동안 3초마다 loginTick — 끝나면 onEnd(null), 상한·실패면 onEnd(오류 이름).
 *  창이 닫혀도 쉬기는 남아 자동 전환이 15초마다 마무리한다(LOGIN_HOLD_MS 까지) */
export function useAccountLogin(onEnd: (err: string | null) => void) {
  const [login, setLogin] = useState<{ id: string; email: string } | null>(null);
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    if (!login) return;
    let going = false;
    const t = setInterval(() => {
      if (going) return;
      going = true;
      void accountsApi.view()
        .then(async (v) => {
          const r = await loginTick(v);
          if (r === 'wait') return;
          setLogin(null);
          // none = 자동 전환이 먼저 마무리했거나(그 계정) 상한으로 풀렸다
          end.current(r === 'done' || (r === 'none' && v.active === login.id) ? null : 'loginTimeout');
        })
        .catch((e: unknown) => { setLogin(null); end.current(String(e)); })
        .finally(() => { going = false; });
    }, 3000);
    return () => clearInterval(t);
  }, [login]);
  return [login, setLogin] as const;
}

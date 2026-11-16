// 폰 계정 시트 칸 — data/web 대신(맥 터널·열쇠 없이). 부른 것을 적고 index.html 의 가짜 계정 셋을 폰 모양으로 준다
type W = { __S: { accounts: { id: string; name: string; plan: string }[]; active: string; auto: unknown }; __calls: { cmd: string; args: unknown; at: number; active: string }[] };
const w = window as unknown as W;
export const phoneText = () => JSON.stringify({ accounts: w.__S.accounts.map(({ id, name, plan }) => ({ id, name, plan })), active: w.__S.active, livePlan: null, liveName: null, switching: false, auto: w.__S.auto });
const rec = (cmd: string, args: unknown) => w.__calls.push({ cmd, args, at: Date.now(), active: w.__S.active });
export const readAccounts = async () => { rec('phone_read', null); return phoneText(); };
/** 맥 accounts::switch_pinned 처럼 — 로그인 막힌 칸은 needsLogin 으로 거절, 약관 막힌 칸은 그 칸 막힘만 풀고 바꾸기+고정(Rust 판단은 cargo 시험이 본다) */
export const switchAccount = async (id: string) => {
  rec('phone_switch', { id });
  const auto = w.__S.auto as { pinned?: string; switchedAt?: number; slots: Record<string, Record<string, unknown>> };
  const sl = auto.slots[id];
  if (sl && Number(sl.blockedUntil) > Date.now()) {
    if (sl.why === 'auth') throw new Error('needsLogin');
    if (sl.why === 'terms') { delete sl.blockedUntil; delete sl.why; delete sl.blockFp; sl.openedAt = Date.now(); }
  }
  w.__S.active = id;
  auto.pinned = id;
  auto.switchedAt = Date.now();
  return phoneText();
};
export const setAccountAuto = async (on: boolean) => { rec('phone_auto', { on }); return phoneText(); };

// 사람이 고른 계정 = 고정(자동 전환은 그 계정이 다 찰 때 다시) — 설정 '계정' 칸과 위 막대 계정 칩 팝오버가 같은 길로 바꾼다
import { accountsApi } from '../data/tauri';
import { pinPatch } from '../domain/accountAuto';
import type { AccountsView } from '../domain/accounts';

export async function pinActive(v: AccountsView): Promise<AccountsView> {
  return v.active ? accountsApi.autoPatch(pinPatch(v.active, Date.now())) : v;
}

export async function switchPinned(id: string): Promise<AccountsView> {
  return pinActive(await accountsApi.switchTo(id));
}

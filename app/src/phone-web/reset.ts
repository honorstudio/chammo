// 이 폰의 짝짓기 지우기 — 다른 컴퓨터로 바꿀 때(보안 검토 A)·연결이 풀려 다시 이을 때(입구·폰 화면이 같이 쓴다)
import { forgetKeys } from './keys';
import { saveLink } from './link';
import { dropShell } from './shell';

const drop = (k: string) => { try { localStorage.removeItem(k); } catch { /* 개인 정보 보호 모드 */ } };

/** 받아 둔 화면·토큰·계정 표시·링크를 지운다(열쇠는 부르는 쪽이) */
export async function wipeAll(): Promise<void> {
  await dropShell().catch(() => {});
  drop('chammo.token');
  drop('chammo.account');
  saveLink(null);
}

/** 다시 잇기 — 열쇠까지 다 지운다. 사람이 누를 때만. 그다음은 /pair 의 계정 로그인·숫자 확인 그대로 */
export async function unlinkPhone(): Promise<void> {
  await wipeAll();
  await forgetKeys().catch(() => {});
}

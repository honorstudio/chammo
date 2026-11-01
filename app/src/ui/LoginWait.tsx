// 구글 로그인을 기다리는 동안 — 브라우저 다시 열기·취소(11-01 QA H3: 탭을 닫으면 10분 동안 빠져나갈 길이 없었다)
import { invoke } from '@tauri-apps/api/core';
import { tr } from '../i18n';

/** Rust team_account::CANCELLED — 사람이 취소한 건 오류 줄에 안 띄운다 */
export const loginCancelled = (e: unknown) => String(e).includes('로그인을 취소했어요');

export function LoginWait() {
  return (
    <span className="lw-acts">
      <button type="button" className="peer-alt" onClick={() => void invoke('team_login_reopen').catch(() => {})}>{tr('브라우저 다시 열기', 'Reopen browser')}</button>
      <button type="button" className="peer-alt" onClick={() => void invoke('team_login_cancel').catch(() => {})}>{tr('취소', 'Cancel')}</button>
    </span>
  );
}

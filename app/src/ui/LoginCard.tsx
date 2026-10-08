// 로그인 풀림 카드 — 결정 대기함 맨 위 하나(세션마다 칸을 안 띄운다). [로그인] = 카드 안 터미널에서 claude auth login(설정 마법사와 같은 길).
// 로그인이 끝나면 ui/useLogin 이 로그인 칸 고친 시각을 보고 멈춘 세션에 이어서를 보내고 카드는 저절로 내려간다
import { useState } from 'react';
import type { LoginNeed } from '../domain/login';
import { setupCommand } from '../domain/setup';
import { tr } from '../i18n';
import { IconClose } from './Icons';
import { TerminalPane } from './TerminalPane';

export function LoginCard({ need, claude, fontSize }: { need: LoginNeed; claude?: string | null; fontSize: number }) {
  const [open, setOpen] = useState(false);
  const where = need.sessions.length ? need.sessions.join(' · ') : tr('이 맥', 'This Mac');
  return (
    <div className="login-card" role="alert">
      <div className="login-card-top">
        <b>{tr('Claude 로그인이 풀렸어요', 'Claude sign-in expired')}</b>
        {!open && <button className="btn pri login-card-btn" onClick={() => setOpen(true)}>{tr('로그인', 'Sign in')}</button>}
        {open && <button className="ib" title={tr('터미널 닫기', 'Close terminal')} aria-label={tr('닫기', 'Close')} onClick={() => setOpen(false)}><IconClose /></button>}
      </div>
      <div className="login-card-where">{tr(`멈춘 곳: ${where}`, `Stopped: ${where}`)}</div>
      {open && (
        <div className="login-card-term">
          <TerminalPane key="login-card" command={setupCommand('login', { claude }, tr('끝났어요. 멈춘 세션은 저절로 이어서 해요.', 'Done. Stopped sessions will continue on their own.'))}
            title={tr('Claude 로그인', 'Claude sign-in')} subtitle={tr('브라우저에서 로그인하고 돌아오세요', 'Sign in in the browser, then come back')} fontSize={fontSize} />
        </div>
      )}
    </div>
  );
}

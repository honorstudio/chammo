// 로그인 풀림 카드 — 결정 대기함 맨 위 하나(세션마다 칸을 안 띄운다). [로그인] = 카드 안 터미널에서 claude auth login(설정 마법사와 같은 길).
// 로그인이 끝나면 ui/useLogin 이 로그인 칸 고친 시각을 보고 멈춘 세션에 이어서를 보내고 카드는 저절로 내려간다
import { useState } from 'react';
import { openTarget } from '../data/tauri';
import { needText, termsText, type LoginNeed, type TermsCard } from '../domain/login';
import { setupCommand } from '../domain/setup';
import { tr } from '../i18n';
import { IconClose, IconRefresh } from './Icons';
import { TerminalPane } from './TerminalPane';

export function LoginCard({ need, claude, fontSize }: { need: LoginNeed; claude?: string | null; fontSize: number }) {
  const [open, setOpen] = useState(false);
  const t = needText(need);
  return (
    <div className="login-card" role="alert">
      <div className="login-card-top">
        <b>{t.title}</b>
        {!open && <button className="btn pri login-card-btn" onClick={() => setOpen(true)}>{tr('로그인', 'Sign in')}</button>}
        {open && <button className="ib" title={tr('터미널 닫기', 'Close terminal')} aria-label={tr('닫기', 'Close')} onClick={() => setOpen(false)}><IconClose /></button>}
      </div>
      <div className="login-card-where">{t.where}</div>
      {open && (
        <div className="login-card-term">
          <TerminalPane key="login-card" command={setupCommand('login', { claude }, tr('끝났어요. 멈춘 세션은 저절로 이어서 해요.', 'Done. Stopped sessions will continue on their own.'))}
            title={tr('Claude 로그인', 'Claude sign-in')} subtitle={tr('브라우저에서 로그인하고 돌아오세요', 'Sign in in the browser, then come back')} fontSize={fontSize} />
        </div>
      )}
    </div>
  );
}

/** 약관 동의 필요 카드 — 계정마다 하나. 동의는 사람이 claude.ai 에서 그 계정으로 직접(앱이 대신 누르지 않는다).
 *  [다시 시도] = 멈춘 세션에 이어서 + 계정 풀 약관 막힘 풀기(ui/useLogin). 아직 동의 전이면 다음 오류에 다시 뜬다 */
export function TermsCards({ cards, onRetry, onClose }: { cards: TermsCard[]; onRetry: (id: string) => void; onClose: (c: TermsCard) => void }) {
  if (!cards.length) return null;
  return <div className="terms-cards">{cards.map((c) => {
    const t = termsText(c);
    return (
      <div key={c.id} className="login-card" role="alert">
        <div className="login-card-top">
          <b>{t.title}</b>
          <button className="ib" title={tr('다시 시도', 'Retry')} aria-label={tr('다시 시도', 'Retry')} onClick={() => onRetry(c.id)}><IconRefresh /></button>
          <button className="ib" title={tr('닫기', 'Close')} aria-label={tr('닫기', 'Close')} onClick={() => onClose(c)}><IconClose /></button>
        </div>
        <div className="login-card-where">{t.where}</div>
        <div className="terms-card-acts">
          <button className="btn pri login-card-btn" onClick={() => void openTarget('url', 'https://claude.ai').catch(() => {})}>{tr('claude.ai 열기', 'Open claude.ai')}</button>
        </div>
      </div>
    );
  })}</div>;
}

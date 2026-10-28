import { orchVars } from '../../domain/orchTheme';
import { assistant, tr } from '../../i18n';
import { IconChatSend } from '../Icons';
import { IconButton } from '../kit/IconButton';

/** 받는 참모 — 보이는 이름과 그 참모 색(프사에서 고른 색 먼저) */
export type OrchTo = { name: string; color: string };

/**
 * 참모에게 보내기 — 그 참모 색으로 채운 말풍선(2026-10-11 사용자 176.png: 클립이라 참모에게 보내는 건지 헷갈렸다).
 * 누르면 그 참모 채팅 입력칸에 파일이 붙는다(보내기는 사람이). 보관함 카드·탭 머리·크게 보기 창이 같은 단추
 */
export function SendToOrch({ to, onClick, size = 'm', className }: { to?: OrchTo | null; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; size?: 's' | 'm'; className?: string }) {
  const name = to?.name || assistant();
  const label = tr(`${name}에게 보내기`, `Send to ${name}`);
  return (
    <IconButton size={size} className={['send-orch', className].filter(Boolean).join(' ')} label={label} title={tr(`${label} — 채팅 입력칸에 붙는다`, `${label} — attaches to the chat input`)}
      style={to ? (orchVars(to.color) as React.CSSProperties) : undefined} onClick={onClick}><IconChatSend /></IconButton>
  );
}

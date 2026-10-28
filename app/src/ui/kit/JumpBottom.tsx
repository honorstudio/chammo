import { tr } from '../../i18n';
import { IconChevronDown } from '../Icons';
import { Badge } from './Badge';
import './kit.css';

// 맨 아래로(ui/kit) — 위로 올려 읽는 중에만 뜨는 둥근 단추. 참모 채팅·팀챗이 같이 쓴다. n = 그새 온 새 말 수(0 이면 숫자 없이)
// 모양은 kit.css .kit-jump, 자리는 놓이는 곳 클래스(.chat-bottom·.tmx-jump)가 정한다
export function JumpBottom({ onClick, n = 0, className }: { onClick: () => void; n?: number; className?: string }) {
  const label = n > 0 ? tr(`맨 아래로 · 새 말 ${n}개`, `Jump to latest · ${n} new`) : tr('맨 아래로', 'Jump to latest');
  return (
    <button type="button" className={['kit-jump', className].filter(Boolean).join(' ')} onClick={onClick} aria-label={label} title={label}>
      <IconChevronDown />
      <Badge n={n} className="kit-jump-n" />
    </button>
  );
}

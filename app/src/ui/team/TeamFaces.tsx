// 메신저 얼굴 — 사람 = 둥근 프사(첫 글자), 참모 = 네모 얼굴(눈 둘, 주인과 같은 색 — 짝이 한눈에), 팀 = 둥근 네모 + 첫 글자(시안 v2)
import { teamMark } from '../../domain/teamChat';

type S = React.CSSProperties;
const v = (c: string, s: number): S => ({ ['--c' as string]: c, ['--s' as string]: `${s}px` });

export const Person = ({ name, color, size = 28 }: { name: string; color: string; size?: number }) => (
  <span className="tmx-pa" style={v(color, size)} aria-hidden="true">{[...name.trim()][0] ?? '?'}</span>
);

export const Face = ({ color, size = 28 }: { color: string; size?: number }) => <span className="tmx-face" style={v(color, size)} aria-hidden="true" />;

export const TeamMarkIcon = ({ name, size = 30, badge, on }: { name: string; size?: number; badge?: number; on?: boolean }) => {
  const m = teamMark(name);
  return (
    <span className={`tmx-tm ${on ? 'on' : ''}`} style={v(m.color, size)} aria-hidden="true">
      {m.letter}{badge ? <i className="tmx-ur">{badge > 99 ? '99+' : badge}</i> : null}
    </span>
  );
};

/** 안 읽은 수 점 — 숫자 */
export const Unread = ({ n, inline }: { n: number; inline?: boolean }) => (n > 0 ? <i className={`tmx-ur ${inline ? 'in' : ''}`}>{n > 99 ? '99+' : n}</i> : null);

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './kit.css';

// 데스크톱 공용 아이콘 버튼(ui/kit — 의존성 0, 우리 토큰만 읽는다. 2026-10-11 UI 재조사).
// 익숙한 동작(닫기·빼기·열기·보내기·접기…)은 글자 대신 Icons.tsx 의 직접 그린 SVG 하나 — 이름은 aria-label·title 로.
// 크기 s 24 · m 28 · l 34(.btn 높이와 같다). 톤: ghost(기본, 판 없음) · line(테두리 — 글자 버튼 줄에 섞일 때) · pri · danger
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  /** 버튼 이름 — 화면 읽기·마우스 올림 */
  label: string;
  /** 마우스 올림 글이 이름과 다르면(단축키·긴 설명) */
  title?: string;
  size?: 's' | 'm' | 'l';
  tone?: 'ghost' | 'line' | 'pri' | 'danger';
  /** 켜짐(토글) */
  pressed?: boolean;
  /** 하는 중 — 못 누르고 아이콘이 깜빡인다. 이름은 busyLabel 로 바뀐다 */
  busy?: boolean;
  busyLabel?: string;
  children?: ReactNode;
};

export function IconButton({ label, title, size = 'm', tone = 'ghost', pressed, busy, busyLabel, className, type = 'button', disabled, children, ...rest }: Props) {
  const name = busy && busyLabel ? busyLabel : label;
  const cls = ['kit-ib', `kit-ib-${size}`, tone !== 'ghost' && `kit-ib-${tone}`, pressed && 'on', busy && 'kit-ib-busy', className].filter(Boolean).join(' ');
  return (
    <button {...rest} type={type} className={cls} aria-label={name} title={busy && busyLabel ? busyLabel : title ?? label}
      aria-pressed={pressed} aria-busy={busy || undefined} disabled={disabled || busy}>
      {children}
    </button>
  );
}

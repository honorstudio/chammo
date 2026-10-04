// 앱 대표 캐릭터 — 첫 참모 기본 프사와 같은 파란 모찌(domain/avatar BRAND, 앱 아이콘과 같다). 첫 실행·빈 화면 같은 대표 자리에
import { avatarClasses, BRAND } from '../../domain/avatar';
import { PresetSvg } from './shapes';
import './avatar.css';

/** 프사 저장소를 안 읽는다(OrchAvatar 와 달리) — 폰이 연결 전이면 읽기가 실패한 채 굳어 연결 뒤에도 기본형만 보인다. 쉼 상태(느린 숨·깜빡) */
export function BrandMark({ size, className }: { size: number; className?: string }) {
  const style = { '--oa-s': `${size}px`, '--oa-body': BRAND.color, '--oa-d': '0s', '--oa-k': '1' } as React.CSSProperties;
  const cls = avatarClasses({ image: false, state: 'rest', transition: null, size }) + (className ? ` ${className}` : '');
  return <span className={cls} style={style} aria-hidden="true"><PresetSvg shape={BRAND.shape} eyes={BRAND.eyes} /></span>;
}

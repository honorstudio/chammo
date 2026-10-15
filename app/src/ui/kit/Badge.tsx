import './kit.css';

// 숫자 배지(ui/kit) — 아이콘 모서리 개수·구역 개수. 0 이면 안 그린다(zero 면 0 도), 99 넘으면 99+.
// 바탕 크기·글자는 kit.css(:where — 특정도 0), 자리·색은 놓이는 곳 클래스(.rv-n·.bell-n·.tp-count)가 정한다
export function Badge({ n, zero, className }: { n: number; zero?: boolean; className?: string }) {
  if (n <= 0 && !zero) return null;
  return <span className={['kit-badge', className].filter(Boolean).join(' ')}>{n > 99 ? '99+' : n}</span>;
}

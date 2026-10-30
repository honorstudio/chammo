import './kit.css';

// 유료 예정 기능(메신저·팀 보관함·기기 연결)의 'Beta' 표시(ui/kit) — 한·영 둘 다 'Beta' 한 단어, 누름·풍선 없는 작은 알약만(2026-10-29 사용자).
// 자리는 놓이는 곳 클래스가 정한다
export function BetaTag({ className }: { className?: string }) {
  return <span className={['kit-beta', className].filter(Boolean).join(' ')} role="note" aria-label="Beta">Beta</span>;
}

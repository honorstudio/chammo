import { MAX_STAR, nextStar, starOf } from '../../domain/gacha';
import { tr } from '../../i18n';

// 직접 그린 7×7 도트 별 — 이모지·글자 ★ 대신(도감 도트 톤)
const STAR = ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'];
const cells = STAR.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? [x, y] : null)).filter(Boolean)) as [number, number][];

function Pip({ on, pop }: { on: boolean; pop?: boolean }) {
  return (
    <svg viewBox="0 0 7 7" className={`star-pip ${on ? 'on' : ''} ${pop ? 'pop' : ''}`} shapeRendering="crispEdges" aria-hidden>
      {cells.map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="1" height="1" />)}
    </svg>
  );
}

/** 가진 개수 → 별 다섯 칸(채운 것 = 별). up = 방금 오른 별을 반짝 */
export function Stars({ count, up }: { count: number; up?: boolean }) {
  const n = starOf(count);
  if (!n) return null;
  const left = nextStar(count);
  const label = left === null ? tr(`별 ${n} — 최고`, `${n} stars — max`) : tr(`별 ${n} — 다음 별까지 중복 ${left}`, `${n} stars — ${left} more duplicate${left > 1 ? 's' : ''} to the next`);
  return (
    <span className="stars" role="img" aria-label={label} title={label}>
      {Array.from({ length: MAX_STAR }, (_, i) => <Pip key={i} on={i < n} pop={up && i === n - 1} />)}
    </span>
  );
}

/** 별 하나 + 숫자 — 도감 머리의 별 합계 */
export function StarCount({ have, max }: { have: number; max: number }) {
  const label = tr(`별 ${have} / ${max}`, `Stars ${have} / ${max}`);
  return <span className="star-count" role="img" aria-label={label} title={label}><Pip on /><span>{have}<i>/{max}</i></span></span>;
}

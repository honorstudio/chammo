// 프사 도형 13개의 몸(viewBox 0 0 40 40)과 눈 자리 — 시안 docs/design-drafts/avatar/gen_v2.py 와 같은 값.
// SVG 경로 숫자 데이터라 길다(직접 고칠 일은 시안 생성기와 함께)
import type { ReactNode } from 'react';
import type { Eyes, Shape } from '../../domain/avatar';

const star = (cx: number, cy: number, R: number, r: number) =>
  'M' + Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5; const d = i % 2 ? r : R; return `${(cx + d * Math.cos(a)).toFixed(2)} ${(cy + d * Math.sin(a)).toFixed(2)}`; }).join('L') + 'Z';
const hexa = (cx: number, cy: number, R: number) =>
  'M' + Array.from({ length: 6 }, (_, i) => `${(cx + R * Math.cos((i * Math.PI) / 3)).toFixed(2)} ${(cy + R * Math.sin((i * Math.PI) / 3)).toFixed(2)}`).join('L') + 'Z';

/** body + 눈 자리 [눈 높이, 가운데서 떨어진 거리, 눈 크기] */
export const SHAPE_SVG: Record<Shape, { body: ReactNode; eye: [number, number, number] }> = {
  circle: { body: <circle className="oa-body" cx="20" cy="21" r="15" />, eye: [20.5, 6.0, 5.4] },
  tri: { body: <path className="oa-body" d="M20 5.5Q22.2 5.5 23.6 8.2L35.6 29.6Q37.2 33.5 33 33.5L7 33.5Q2.8 33.5 4.4 29.6L16.4 8.2Q17.8 5.5 20 5.5Z" />, eye: [25, 5.2, 4.4] },
  square: { body: <rect className="oa-body" x="5.5" y="7" width="29" height="28" rx="8" />, eye: [20.5, 6.2, 5.4] },
  drop: { body: <path className="oa-body" d="M20 4.5C24.5 10.5 33.5 16.5 33.5 24.5A13.5 13.5 0 0 1 6.5 24.5C6.5 16.5 15.5 10.5 20 4.5Z" />, eye: [24.5, 5.6, 4.8] },
  mochi: { body: <path className="oa-body" d="M20 7C27 7 31 11.5 32.2 17.5C33.2 22.5 36.5 25 36 29C35.4 33.5 29 34.5 20 34.5C11 34.5 4.6 33.5 4 29C3.5 25 6.8 22.5 7.8 17.5C9 11.5 13 7 20 7Z" />, eye: [22.5, 6.3, 5.2] },
  bun: { body: <path className="oa-body" d="M20 9.5C23.5 9.5 25 7.6 28.6 7.8C33.6 8.2 35.4 13 35.2 19C35 27 31.6 33.6 20 33.6C8.4 33.6 5 27 4.8 19C4.6 13 6.4 8.2 11.4 7.8C15 7.6 16.5 9.5 20 9.5Z" />, eye: [21, 6.4, 5.2] },
  jelly: { body: <path className="oa-body" d="M20 6.5C27.5 6.5 31 12 31.5 18.5C32 24 35.5 26.5 35.5 30.5C35.5 33.5 32 34.2 28.5 33.2C25.5 32.4 23 34 20 34C17 34 14.5 32.4 11.5 33.2C8 34.2 4.5 33.5 4.5 30.5C4.5 26.5 8 24 8.5 18.5C9 12 12.5 6.5 20 6.5Z" />, eye: [19.5, 5.6, 5.0] },
  star: { body: <path className="oa-body oa-round" d={star(20, 22.6, 13.2, 7.4)} />, eye: [23.2, 3.9, 3.9] },
  cloud: { body: <g className="oa-body"><circle cx="12.5" cy="24" r="7.5" /><circle cx="20" cy="17.5" r="9.5" /><circle cx="28" cy="22.5" r="7.5" /><rect x="5" y="22" width="30" height="11.5" rx="5.75" /></g>, eye: [25, 5.4, 4.6] },
  dome: { body: <path className="oa-body" d="M4.5 28.5A15.5 15.5 0 0 1 35.5 28.5L35.5 30Q35.5 33 32.5 33L7.5 33Q4.5 33 4.5 30Z" />, eye: [24.5, 6.0, 4.6] },
  capsule: { body: <rect className="oa-body" x="3.5" y="11" width="33" height="21" rx="10.5" />, eye: [21.5, 6.6, 4.8] },
  hexa: { body: <path className="oa-body oa-hexa" d={hexa(20, 21, 14)} />, eye: [21, 5.9, 5.0] },
  sprout: {
    body: <><g className="oa-body"><circle cx="20" cy="23" r="13" /><path d="M20 9.6C17.6 5.4 13.2 5 12.4 7.6C14.2 9.8 17.8 10.6 20 9.6Z" /><path d="M20 9.6C22.4 5.4 26.8 5 27.6 7.6C25.8 9.8 22.2 10.6 20 9.6Z" /></g><path className="oa-stem" d="M20 11L20 9.4" /></>,
    eye: [23.5, 5.6, 4.8],
  },
};

const f = (n: number) => Number(n.toFixed(2));

type EyeProps = { x: number; ey: number; r: number; kind: Eyes };
const eyeSize = (r: number, kind: Eyes) => ({ a: kind === 'pupil' ? r * 0.52 : r * 0.44, b: kind === 'pupil' ? r * 0.72 : r * 0.64 });
/** 눈 하나의 묶음 — 작은 프사(oa-s16)에서 눈마다 키우는 기준점을 눈 가운데로(층마다 같은 점이라 겹친 장이 안 어긋난다) */
const EyeG = ({ x, ey, children }: { x: number; ey: number; children: ReactNode }) => <g className="oa-eye" style={{ transformOrigin: `${f(x)}px ${f(ey)}px` }}>{children}</g>;

/** 흰자(검은 눈이면 검은 눈+반짝) */
function EyeWhite({ x, ey, r, kind }: EyeProps) {
  const { a, b } = eyeSize(r, kind);
  return (
    <EyeG x={x} ey={ey}><g className="oa-eyev">
      {kind === 'dark' ? (
        <>
          <ellipse className="oa-k" cx={f(x)} cy={f(ey)} rx={f(a)} ry={f(b)} />
          <circle className="oa-gl" cx={f(x + a * 0.28)} cy={f(ey - b * 0.36)} r={f(r * 0.21)} />
        </>
      ) : <ellipse className="oa-w" cx={f(x)} cy={f(ey)} rx={f(a)} ry={f(b)} />}
    </g></EyeG>
  );
}

/** 눈동자(pupil 눈만) */
function EyePupil({ x, ey, r }: EyeProps) {
  return <EyeG x={x} ey={ey}><circle className="oa-k" cx={f(x)} cy={f(ey + r * 0.16)} r={f(r * 0.3)} /><circle className="oa-gl" cx={f(x + r * 0.1)} cy={f(ey + r * 0.04)} r={f(r * 0.1)} /></EyeG>;
}

/** 위아래 눈꺼풀(몸 색) + 감은 눈 선 + 웃는 눈 — 눈동자 층 위에 덮인다 */
function EyeLids({ x, ey, r, kind }: EyeProps) {
  const { a, b } = eyeSize(r, kind);
  const la = a + 0.55;
  const lb = b + 0.45;
  return (
    <EyeG x={x} ey={ey}>
      <rect className="oa-lt" x={f(x - la)} y={f(ey - lb)} width={f(2 * la)} height={f(lb + 0.25)} />
      <rect className="oa-lb" x={f(x - la)} y={f(ey - 0.25)} width={f(2 * la)} height={f(lb + 0.25)} />
      <path className="oa-shut" d={`M${f(x - a * 1.05)} ${f(ey)}Q${f(x)} ${f(ey + b * 0.62)} ${f(x + a * 1.05)} ${f(ey)}`} />
      <path className="oa-smile" d={`M${f(x - a * 1.1)} ${f(ey + b * 0.3)}Q${f(x)} ${f(ey - b)} ${f(x + a * 1.1)} ${f(ey + b * 0.3)}`} />
    </EyeG>
  );
}

const Sv = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">{children}</svg>;

/**
 * 몸 + 얼굴 — 움직임은 전부 CSS(avatar.css). 움직이는 묶음(전환 oa-tr·몸 oa-all·얼굴 oa-face·눈 oa-eyes·눈동자 oa-pup)은
 * SVG 안 <g> 가 아니라 겹친 HTML 층이다 — SVG 안쪽을 움직이면 WebKit 이 합성기로 못 돌려 매 프레임 다시 칠했다
 * (2026-10-12 사용자 '가만히 있어도 무겁다': 띠 프사 5개 GPU 50% → 층 나누기 1.2~1.4%, WebKit 하네스).
 * 장 순서 = 몸 / 흰자 / 눈동자 / 눈꺼풀 — 감으면 눈꺼풀이 눈동자를 덮는다
 */
export function PresetSvg({ shape, eyes }: { shape: Shape; eyes: Eyes }) {
  const { body, eye: [ey, dx, r] } = SHAPE_SVG[shape];
  const both = (E: (p: EyeProps) => ReactNode) => <>{E({ x: 20 - dx, ey, r, kind: eyes })}{E({ x: 20 + dx, ey, r, kind: eyes })}</>;
  return (
    <span className="oa-l oa-tr" aria-hidden="true"><span className="oa-l oa-all">
      <Sv>{body}</Sv>
      <span className="oa-l oa-face"><span className="oa-l oa-eyes" style={{ '--oa-ey': `${f((ey / 40) * 100)}%` } as React.CSSProperties}>
        <Sv>{both(EyeWhite)}</Sv>
        {eyes === 'pupil' && <span className="oa-l oa-pup"><Sv>{both(EyePupil)}</Sv></span>}
        <Sv>{both(EyeLids)}</Sv>
      </span></span>
    </span></span>
  );
}

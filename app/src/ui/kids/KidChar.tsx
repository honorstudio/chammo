// 아이 화면 참모 캐릭터(시안 screen-v3 · kids3_kid.kchar) — 그 참모의 원래 도형(SHAPE_SVG)·눈·색 + 볼·입·손.
// 몸은 위가 조금 밝은 같은 색, 눈은 그 참모 눈 종류 그대로. 상태마다 움직임(CSS)·눈·입·머리 위 표시만 바뀐다
import { useId } from 'react';
import type { Eyes, Shape } from '../../domain/avatar';
import { SHAPE_SVG } from '../avatar/shapes';

export type KidState = 'idle' | 'listen' | 'think' | 'talk' | 'joy' | 'sleep';

/** 도형마다 [몸 위 끝, 몸 아래 끝, 반짝이 x, y] — kids3_kid.SHAPES 의 숫자 그대로 */
const GEO: Record<Shape, [number, number, number, number]> = {
  circle: [6, 36, 13.4, 10.6], tri: [5.5, 33.5, 16.8, 13.2], square: [7, 35, 12.4, 11.6], drop: [4.5, 38, 14.6, 16.4], mochi: [7, 34.5, 13.2, 11.8],
  bun: [7.8, 33.6, 10.4, 13.2], jelly: [6.5, 34, 13.6, 11.2], star: [7, 35.5, 16.6, 13.4], cloud: [8, 33.5, 15.2, 12.4], dome: [13, 33, 11.8, 19],
  capsule: [11, 32, 10.6, 15.4], hexa: [7.2, 34.8, 13.4, 12.4], sprout: [10, 36, 14, 15.4],
};
const INK = '#163b82';
const f = (n: number) => Number(n.toFixed(2));

function hex(c: string) {
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}
/** 두 색 섞기(t = b 쪽 비율) */
export function mix(a: string, b: string, t: number) {
  const [x, y] = [hex(a), hex(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('');
}

function Eye({ x, ey, r, kind }: { x: number; ey: number; r: number; kind: Eyes }) {
  const a = kind === 'pupil' ? r * 0.52 : r * 0.44, b = kind === 'pupil' ? r * 0.72 : r * 0.64;
  if (kind === 'dark') return <><ellipse cx={f(x)} cy={f(ey)} rx={f(a)} ry={f(b)} fill="#1d1d20" /><circle cx={f(x + a * 0.28)} cy={f(ey - b * 0.36)} r={f(r * 0.21)} fill="#fff" /></>;
  return (
    <>
      <ellipse cx={f(x)} cy={f(ey)} rx={f(a)} ry={f(b)} fill="#fff" />
      {kind === 'pupil' && <><circle cx={f(x)} cy={f(ey + r * 0.16)} r={f(r * 0.3)} fill="#1d1d20" /><circle cx={f(x + r * 0.1)} cy={f(ey + r * 0.04)} r={f(r * 0.1)} fill="#fff" /></>}
    </>
  );
}

function EyesFor({ shape, kind, state, lid }: { shape: Shape; kind: Eyes; state: KidState; lid: string }) {
  const [ey, dx, r] = SHAPE_SVG[shape].eye;
  const xs = [20 - dx, 20 + dx];
  const a = kind === 'pupil' ? r * 0.52 : r * 0.44, b = kind === 'pupil' ? r * 0.72 : r * 0.64;
  if (state === 'sleep') return <>{xs.map((x) => <path key={x} d={`M${f(x - a * 1.05)} ${f(ey)}Q${f(x)} ${f(ey + b * 0.62)} ${f(x + a * 1.05)} ${f(ey)}`} fill="none" stroke="#fff" strokeWidth={f(r * 0.22)} strokeLinecap="round" />)}</>;
  if (state === 'joy') return <>{xs.map((x) => <path key={x} d={`M${f(x - a * 1.1)} ${f(ey + b * 0.3)}Q${f(x)} ${f(ey - b)} ${f(x + a * 1.1)} ${f(ey + b * 0.3)}`} fill="none" stroke="#fff" strokeWidth={f(r * 0.25)} strokeLinecap="round" />)}</>;
  const sc = state === 'listen' ? 1.15 : 1;
  const dy = state === 'think' ? -r * 0.16 : 0;
  const top = ey + dy - b * sc - 0.45;
  return (
    <>
      {xs.map((x) => <g key={x} transform={`translate(${f(x)} ${f(ey + dy)}) scale(${sc}) translate(${f(-x)} ${f(-ey)})`}><Eye x={x} ey={ey} r={r} kind={kind} /></g>)}
      {/* 눈 깜빡임 — 몸 색 눈꺼풀이 위에서 내려온다(시안 기본 open 은 다 뜬 눈, 쉼 .14 는 보호자 프사 몫) */}
      <rect className="kc-lid" x={f(20 - dx - a * 1.5)} y={f(top)} width={f(2 * dx + a * 3)} height={f(2 * b * sc + 0.9)} fill={lid} style={{ ['--lid' as string]: 0 }} />
    </>
  );
}

function Mouth({ state }: { state: KidState }) {
  if (state === 'talk') return <ellipse className="kc-talk" cx="20" cy="28" rx="1.05" ry="1.2" fill={INK} />;
  if (state === 'listen') return <ellipse cx="20" cy="28" rx=".95" ry="1.15" fill={INK} />;
  if (state === 'sleep') return <path d="M19 28.1Q20 28.7 21 28.1" fill="none" stroke={INK} strokeWidth=".7" strokeLinecap="round" />;
  return <path d="M18.5 27.5Q20 29 21.5 27.5" fill="none" stroke={INK} strokeWidth=".78" strokeLinecap="round" />;
}

/** 아이 화면 캐릭터 — 크기는 감싼 칸이 정한다(viewBox = 몸, 손·머리 위 표시는 밖으로 넘친다) */
export function KidChar({ shape, eyes, color, state }: { shape: Shape; eyes: Eyes; color: string; state: KidState }) {
  const gid = `kg${useId().replace(/[^a-z0-9]/gi, '')}`;
  const [top, bottom, hx, hy] = GEO[shape];
  const [ey, dx, r] = SHAPE_SVG[shape].eye;
  const k = r / 5.2;
  const body = state === 'sleep' ? mix(color, '#2b2f6b', 0.32) : color;
  const lid = mix(body, '#ffffff', 0.1);
  const hand = mix(body, '#000000', 0.12);
  return (
    <svg className={`kc kcs-${state}`} viewBox="2 2 36 38" aria-hidden="true">
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="5" x2="0" y2="36">
          <stop offset="0" stopColor={mix(body, '#ffffff', 0.3)} /><stop offset=".55" stopColor={mix(body, '#ffffff', 0.08)} /><stop offset="1" stopColor={body} />
        </linearGradient>
      </defs>
      <ellipse cx="20" cy={f(bottom + 0.3)} rx="13" ry="1.7" fill="#000" opacity=".15" />
      <g className="kc-b" style={{ transformOrigin: `20px ${bottom}px` }}>
        <g className="kc-body" style={{ ['--oa-c' as string]: `url(#${gid})` }}>{SHAPE_SVG[shape].body}</g>
        <ellipse cx={hx} cy={hy} rx="3.2" ry="1.4" transform={`rotate(-28 ${hx} ${hy})`} fill="#fff" opacity=".48" />
        <circle cx={f(hx + 4.4)} cy={f(hy - 2.2)} r=".58" fill="#fff" opacity=".48" />
        {/* 볼·입 — 눈 자리·크기에 맞춰 */}
        {[-1, 1].map((s) => <ellipse key={s} cx={f(20 + s * (dx + r * 0.74))} cy={f(ey + r * 0.85)} rx={f(2.3 * k)} ry={f(1.25 * k)} fill="#ff8fbd" opacity=".55" />)}
        <g transform={`translate(20 ${f(ey + r)}) scale(${f(k)}) translate(-20 -27.9)`}><Mouth state={state} /></g>
        <EyesFor shape={shape} kind={eyes} state={state} lid={lid} />
      </g>
      {/* 손 — 만드는 중엔 붓을 든다 */}
      {state === 'think' && (
        <g transform={`translate(33.5 ${f(bottom - 7)})`}><g className="kc-dab">
          <g transform="rotate(-40)"><rect x="-3.2" y="-.62" width="12.6" height="1.24" rx=".62" fill="#d99a52" /><rect x="9.2" y="-.95" width="2.3" height="1.9" rx=".3" fill="#cfd6e2" /><path d="M11.4 -1Q15.8 -1.4 17 0Q15.8 1.4 11.4 1Z" fill="#ff7b3a" /></g>
          <circle r="2.25" fill={hand} />
        </g></g>
      )}
      {/* 머리 위 — 듣는 중 반짝, 만드는 중 생각 점, 말하는 중 소리 */}
      {state === 'listen' && <g className="k-spark" transform={`translate(0 ${f(top - 7)})`} stroke="#fff" strokeWidth=".55" strokeLinecap="round"><path d="M11.4 3.4L10.2 2M13.6 2.2L13.6 .6M9.4 5.4L7.9 5.1" /><path d="M28.6 3.4L29.8 2M26.4 2.2L26.4 .6M30.6 5.4L32.1 5.1" /></g>}
      {state === 'think' && <g className="k-think" transform={`translate(0 ${f(top - 7)})`} fill="#fff"><circle cx="32.6" cy="9.2" r=".95" /><circle cx="35.3" cy="5.9" r="1.3" /><circle cx="38.6" cy="2.2" r="1.75" /></g>}
      {state === 'talk' && <g className="k-snd" transform={`translate(0 ${f(bottom - 34)})`} fill="none" stroke="#fff" strokeWidth=".9" strokeLinecap="round"><path d="M38 21.2Q39.9 23.6 38 26" /><path d="M40.2 19.4Q43 23.6 40.2 27.8" /><path d="M42.4 17.6Q46.1 23.6 42.4 29.6" /></g>}
    </svg>
  );
}

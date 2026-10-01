import type { DocKind } from './reader';

/**
 * 리더 확대·축소(사용자 2026-09-29) — 리더를 보고 있을 때 ⌘+ ⌘- ⌘0 은 터미널 글자가 아니라 리더만.
 * 브라우저처럼 정해진 단계로, 크기는 파일 종류마다 기억한다(마크다운 하나 키우면 다음 마크다운도 그 크기)
 */
export const ZOOM_STEPS: readonly number[] = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];
const MIN = 50;
const MAX = 300;
/** 그림 — 0 = 맞춤(가로·세로 다 창 안), 그 밖은 실제 픽셀 기준 %. 긴 폰 캡처는 50% 로도 한 화면에 안 차서 10% 까지(사용자 2026-09-29) */
export const FIT = 0;
export const IMAGE_STEPS: readonly number[] = [10, 25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];
export const zoomLabel = (z: number) => (z === FIT ? '맞춤' : `${z}%`);

export type ZoomMap = Partial<Record<DocKind, number>>;

/** 영상은 확대할 게 없다(창에 맞춰 튼다) */
export const zoomable = (k: DocKind) => k !== 'video' && k !== 'audio' && k !== 'other';

/** 다음 단계 — 단계 사이 값이면 그 방향의 가장 가까운 단계, 끝이면 그대로 */
export function stepZoom(z: number, dir: 1 | -1, steps: readonly number[] = ZOOM_STEPS): number {
  const next = dir > 0 ? steps.find((s) => s > z) : [...steps].reverse().find((s) => s < z);
  return next ?? (dir > 0 ? steps[steps.length - 1]! : steps[0]!);
}

export const zoomOf = (m: ZoomMap, k: DocKind) => m[k] ?? (k === 'image' ? FIT : 100);
export const withZoom = (m: ZoomMap, k: DocKind, z: number): ZoomMap => ({ ...m, [k]: z });

const KINDS: DocKind[] = ['html', 'pdf', 'md', 'image', 'text'];
/** 저장값 읽기 — 모르는 종류·숫자 아닌 값·범위 밖은 버린다 */
export function parseZoom(raw: string | null): ZoomMap {
  let v: unknown;
  try { v = JSON.parse(raw ?? '{}'); } catch { return {}; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: ZoomMap = {};
  for (const k of KINDS) {
    const z = (v as Record<string, unknown>)[k];
    if (typeof z !== 'number') continue;
    if (k === 'image' ? z === FIT || (z >= IMAGE_STEPS[0]! && z <= IMAGE_STEPS[IMAGE_STEPS.length - 1]!) : z >= MIN && z <= MAX) out[k] = z;
  }
  return out;
}

/**
 * ⌘A 를 어디에 쓸까(사용자 2026-09-29: 앱 화면 전체가 잡혔다). 보고 있는 곳 안에서만 —
 * 입력칸 > 터미널 > 리더 문서. 그 밖이면 아무것도 안 한다
 */
export type SelectAllTarget = 'input' | 'terminal' | 'readerText' | 'readerFrame' | 'none';
export function selectAllTarget(c: { editable: boolean; terminal: boolean; reader: boolean; kind: DocKind | null }): SelectAllTarget {
  if (c.editable) return 'input';
  if (c.terminal) return 'terminal';
  if (!c.reader || !c.kind) return 'none';
  if (c.kind === 'md' || c.kind === 'text') return 'readerText';
  if (c.kind === 'html' || c.kind === 'pdf') return 'readerFrame';
  return 'none';
}

// 뽑기 그림 팩 — 종류마다 '도감 아이콘 + 사무실에 그리는 법'을 이름(id 점 뒤)으로 등록한다. icons.ts·draw.ts 가 옛 그림에 없는 이름이면 여기서 찾는다.
// 그림체: 정면 도트(아이콘 24×20 칸, (0,0) 기준), 사무실은 아이소메트릭(P = 칸 → 캔버스 점). 색은 '#rrggbb'·'rgba()' 만, 좌표·크기는 정수
import type { Skin } from '../../office/skins';

export type R = { rect: (x: number, y: number, w: number, h: number, c: string) => void };
/** 바닥 칸(gx, gy, 높이 z) → 캔버스 점 */
export type Pz = (gx: number, gy: number, z?: number) => [number, number];
/** 상자 하나(바닥 칸 gx·gy 에서 w×d, 높이 z 부터 h 만큼) — 윗면·왼쪽 면·오른쪽 면 색, edge = 윗면 테두리 */
export type BoxFn = (gx: number, gy: number, w: number, d: number, z: number, h: number, top: string, left: string, right: string, edge?: string) => void;
export type Dot = (u: number, v: number, w: number, h: number, c: string) => void;

/** 반장 액션이 그릴 때 받는 것 — hx·hy = 머리 위 점(말풍선 자리), px·py = 캐릭터 발 가운데, idle = 반장 반응(말풍선)이 없을 때 */
export type BossCtx = { hx: number; hy: number; px: number; py: number; t: number; fill: string; sk: Skin; idle: boolean };

export type Pack = {
  /** 휴게실 가구 — room: (gx, gy) 칸 왼쪽 위 기준 0.8×0.8 안에 */
  furn?: Record<string, { icon: (b: R) => void; room: (b: R, P: Pz, box: BoxFn, sk: Skin, gx: number, gy: number, t: number) => void }>;
  /** 모자 — (x, y) = 캐릭터(16×16) 왼쪽 위, 머리 꼭대기 줄이 y+1. 아이콘은 곰에 씌워 저절로 */
  hat?: Record<string, (b: R, x: number, y: number) => void>;
  /** 창밖 — icon 은 창 안(2..21, 2..15)에 그린다(틀·창살은 저절로), scene 은 창 안 0..1 좌표 */
  window?: Record<string, { sky: string; icon: (b: R) => void; scene: (t: number, dot: Dot) => void }>;
  /** 책상 소품 — prop: (x, y) = 책상 윗면 위 소품 바닥 가운데, 높이 12 안 */
  desk?: Record<string, { icon: (b: R) => void; prop: (b: R, x: number, y: number, t: number, typing: boolean) => void }>;
  /** 조명 — 방 전체 위(W·H 캔버스, cols·rows 방, focus = 반장 책상 칸) */
  light?: Record<string, { icon: (b: R) => void; scene: (b: R, W: number, H: number, t: number, P: Pz, cols: number, rows: number, focus: [number, number]) => void }>;
  /** 펑 대신 — f = 0..1 진행 */
  fx?: Record<string, { icon: (b: R) => void; burst: (b: R, P: Pz, sk: Skin, gx: number, gy: number, f: number) => void }>;
  /** 칭호 — 도감 띠 색 */
  title?: Record<string, string>;
  /** 펫 친구 — walk: (x, y) = 바닥 발 가운데(캔버스), 12×10 안, flip = 왼쪽 보기 */
  friend?: Record<string, { icon: (b: R) => void; walk: (b: R, x: number, y: number, flip: boolean, t: number, sk: Skin) => void }>;
  /** 반장 액션 — 반장 자리에서 늘(또는 idle 일 때만) 그린다 */
  action?: Record<string, { icon: (b: R) => void; boss: (b: R, c: BossCtx) => void }>;
  /** 방 스킨(색 묶음) + 이름 */
  skin?: Record<string, { skin: Skin; ko: string; en: string }>;
  /** 스킨 장식 — 스킨의 scene 에 이름을 넣으면 그 방에 그린다. k 가 있으면 그 깊이로(바닥 물건), 없으면 벽(캐릭터 뒤) */
  scene?: Record<string, { k?: number; draw: (b: R, P: Pz, sk: Skin, t: number, cols: number, rows: number) => void }>;
};

/** 나무 색 묶음 — 새 스킨은 이걸 펼쳐 바꿀 것만 덮는다(skins.ts 를 불러오면 순환이라 따로 둔다) */
export const BASE: Skin = {
  bg: '#efe6d8', floor: ['#c99e70', '#c1945f'], grain: '#a97c4e', wallL: '#e8d9c0', wallR: '#f3e8d4', wallTop: '#7d5b3d',
  deskTop: '#8d5d3d', deskL: '#6f4531', deskR: '#5a3727', mon: '#2e2a30', monR: '#3b3742', screen: '#1c2838',
  on: ['#7fd1ff', '#ffd27a', '#9ef0a4'], line: '#2a1c14', pets: ['#ffd9a8', '#bfe3ff', '#c9f0c1', '#ffc6d9', '#e6d4ff', '#fff1a6', '#ffcfb0', '#d0f2ee'],
  pat: '#e0a36b', leaf: ['#4d9a57', '#35743f'], pot: '#b8663f', sky: '#bfe5ff', frame: '#8a6a4a', shelf: '#8d5d3d',
  books: ['#d9786b', '#6ea6d9', '#e0b94f', '#7cc48a'], cooler: '#f4f4f4', water: '#8fd0ff', paper: '#ffffff', label: 'light',
};

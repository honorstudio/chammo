// 참모 프사 — 저장 형식·기본형·상태·전환 규칙. 순수 TS(그리는 건 ui/avatar). 시안 docs/design-drafts/avatar v2 확정(2026-10-02 사용자)
import { tr } from '../i18n';
import type { SessionState } from './session';
import { splitOrchName } from './orchLabel';
import { sessionStatus, statusTone, type ActivityStatus } from './status';

/** 참모 색 — 프사 몸 색·채팅 칸 색이 같은 출처(SpaceView 가 다시 내보낸다). 첫 칸 = 대표 캐릭터 색(BRAND) */
export const ORCH_COLORS = ['#2f74e0', '#d9622b', '#1f9a62', '#9b51e0', '#c98a00', '#d23f6b'];

/** 도형 13개 — 기본 4 + 찌글이 3(모찌·말랑 귀·젤리 발) + 새 6. 순서 = 기본 도형 배정 순서(첫 칸 = 대표 캐릭터 도형) */
export const SHAPES = ['mochi', 'circle', 'star', 'cloud', 'capsule', 'sprout', 'tri', 'square', 'drop', 'bun', 'jelly', 'dome', 'hexa'] as const;
export type Shape = (typeof SHAPES)[number];
export const EYES = ['pill', 'pupil', 'dark'] as const;
export type Eyes = (typeof EYES)[number];

/** 앱 대표 캐릭터 = 첫 참모 기본 프사 = 앱 아이콘(docs/design-drafts/app-icon B, 2026-10-03 사용자). 빈 화면·첫 실행 같은 대표 자리도 이것 */
export const BRAND = { shape: 'mochi', eyes: 'pill', color: '#2f74e0' } as const satisfies { shape: Shape; eyes: Eyes; color: string };

export const SHAPE_LABEL: Record<Shape, () => string> = {
  circle: () => tr('동그라미', 'Circle'), tri: () => tr('세모', 'Triangle'), square: () => tr('네모', 'Square'), drop: () => tr('물방울', 'Drop'),
  mochi: () => tr('모찌', 'Mochi'), bun: () => tr('말랑 귀', 'Bun'), jelly: () => tr('젤리', 'Jelly'),
  star: () => tr('별', 'Star'), cloud: () => tr('구름', 'Cloud'), dome: () => tr('반달', 'Dome'), capsule: () => tr('캡슐', 'Capsule'), hexa: () => tr('육각', 'Hexagon'), sprout: () => tr('새싹', 'Sprout'),
};
export const EYES_LABEL: Record<Eyes, () => string> = {
  pill: () => tr('흰 알약', 'White pill'), pupil: () => tr('눈동자', 'Pupil'), dark: () => tr('까만 반짝', 'Dark sparkle'),
};

/** Supertonic 목소리 10개 — Rust tts::VOICES 와 같은 목록 */
export const VOICES = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'] as const;
export type Voice = (typeof VOICES)[number];

export type Crop = { zoom: number; x: number; y: number };
/** voice = 그 참모 목소리(없으면 기본 배정 — defaultVoice) */
export type Preset = { kind: 'preset'; shape: Shape; eyes: Eyes; /** null = 참모 순서 색 */ color: string | null; voice?: Voice | null };
export type ImageAvatar = { kind: 'image'; file: string; crop: Crop; voice?: Voice | null };
export type Avatar = Preset | ImageAvatar;
export type AvatarEntry = { key: string; avatar: Avatar; /** 그림이 바뀌면 바뀌는 값 — 주소 캐시 깨기 */ v: number };

export type AvatarState = 'work' | 'rest' | 'ask' | 'off';
export type Transition = 'wake' | 'alert' | 'sleep' | 'calm' | 'joy';

export const MAX_IMAGE = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const IMAGE_EXTS = ['png', 'jpg', 'gif', 'webp'];

const DEFAULT_KEY = '참모';

/** 프사 키 = 별명 앞 기본 이름(NFC) — Rust avatars/<키>.json */
export function avatarKey(name: string): string {
  return splitOrchName(name).base.normalize('NFC').trim() || DEFAULT_KEY;
}

/** Rust safe_key 와 같은 규칙 */
export function validKey(k: string): boolean {
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(k)) return false; // 윈도우 예약 이름
  return k.length > 0 && [...k].length <= 64 && /^[\p{L}\p{N}\-_ ]+$/u.test(k) && k.trim() === k;
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h ^ c.codePointAt(0)!, 16777619) >>> 0), 2166136261);

/** 기본형 — 이름 끝 번호로 도형을 고르게 돌린다. 번호 없는 이름(참모·참모 — 첫 참모)은 1번째 */
export function defaultAvatar(key: string): Preset {
  const num = key.match(/(\d+)$/)?.[1];
  const i = num ? Number(num) - 1 : 0;
  return { kind: 'preset', shape: SHAPES[((i % SHAPES.length) + SHAPES.length) % SHAPES.length]!, eyes: 'pill', color: null };
}

const isNum = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const COLOR = /^#[0-9a-fA-F]{6}$/;

function parseAvatar(key: string, a: unknown): Avatar | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const voice = VOICES.includes(o.voice as Voice) ? (o.voice as Voice) : null;
  if (o.kind === 'preset') {
    if (!SHAPES.includes(o.shape as Shape) || !EYES.includes(o.eyes as Eyes)) return null;
    return { kind: 'preset', shape: o.shape as Shape, eyes: o.eyes as Eyes, color: typeof o.color === 'string' && COLOR.test(o.color) ? o.color : null, voice };
  }
  if (o.kind === 'image') {
    const c = o.crop as Record<string, unknown> | undefined;
    // 파일 이름은 <키>.<허용 확장자> 만 — 다른 값이면 주소를 만들지 않는다
    if (typeof o.file !== 'string' || !IMAGE_EXTS.some((e) => o.file === `${key}.${e}`)) return null;
    if (!c || !isNum(c.zoom, 1, 4) || !isNum(c.x, -1, 1) || !isNum(c.y, -1, 1)) return null;
    return { kind: 'image', file: o.file, crop: { zoom: c.zoom, x: c.x, y: c.y }, voice };
  }
  return null;
}

/** Rust avatars_read 결과 → 키별 지도. 이상한 줄은 버린다(그 참모는 기본형으로) */
export function parseEntries(raw: unknown): Map<string, AvatarEntry> {
  const out = new Map<string, AvatarEntry>();
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { key, avatar, v } = r as Record<string, unknown>;
    if (typeof key !== 'string') continue;
    const k = key.normalize('NFC');
    const a = validKey(k) ? parseAvatar(k, avatar) : null;
    if (a) out.set(k, { key: k, avatar: a, v: typeof v === 'number' ? v : 0 });
  }
  return out;
}

export function resolveAvatar(saved: Map<string, AvatarEntry>, name: string): Avatar {
  const key = avatarKey(name);
  return saved.get(key)?.avatar ?? defaultAvatar(key);
}

/** 앱이 아는 세션 상태 → 프사 상태. 세션이 없으면 꺼짐. 얼굴도 상태 말·점과 같은 한 표(statusTone) — st 를 주면 그걸로,
 *  없으면 세션만으로(sessionStatus). CLI awaiting(턴 끝남)은 묻는 게 아니라 안 본다(2026-10-04 오피스 A 남은 것 ①) */
export function avatarState(s: { state: SessionState } | undefined, st?: ActivityStatus): AvatarState {
  if (!s) return 'off';
  const tone = statusTone(st ?? sessionStatus(s));
  return tone === 'run' ? 'work' : tone === 'ask' ? 'ask' : 'rest';
}

/** 상태가 바뀔 때 한 번 하는 동작 — 일하다 쉬면 = 일 끝남(웃는 눈) */
export function transitionOf(from: AvatarState, to: AvatarState): Transition | null {
  if (from === to) return null;
  if (to === 'off') return 'sleep';
  if (from === 'off' || to === 'work') return 'wake';
  if (to === 'ask') return 'alert';
  if (from === 'work' && to === 'rest') return 'joy';
  return 'calm';
}

/** 프사 뿌리 클래스 — 결(그림/도형)·상태·전환·작은 크기. 전역 짧은 클래스와 안 겹치게 전부 oa- 접두 */
/** onColor = 참모 색 면 위(고른 탭 알약) — 몸을 흰색으로, 눈을 면 색으로 뒤집는다 */
export type AvatarTone = 'onColor';
export function avatarClasses(o: { image: boolean; state: AvatarState; transition: Transition | null; size: number; tone?: AvatarTone }): string {
  return ['oa', o.image ? 'oa-img' : '', `oa-st-${o.state}`, o.transition ? `oa-tr-${o.transition}` : '', o.size <= 18 ? 'oa-s16' : '', o.tone === 'onColor' ? 'oa-oncolor' : ''].filter(Boolean).join(' ');
}

/** 참모마다 다른 시작 시점(음수 지연, 초)·박자(0.88~1.12) — 여럿이 같이 놓여도 군무처럼 안 맞게 */
export function jitter(key: string): { delay: number; k: number } {
  const h = hash(key);
  return { delay: -((h % 9000) / 1000), k: 0.88 + (((h >>> 13) % 241) / 1000) };
}

/** 참모 기본 색 — 이름 번호로 고정(참모-2 → 2번째, 번호 없는 첫 참모 → 1번째, 도형 defaultAvatar 와 같은 번호).
 *  예전엔 살아 있는 참모 중 몇 번째냐로 골라서, 다른 참모가 꺼지면 순서가 당겨져 색이 바뀌었다(2026-10-03 사용자). 프사에서 고른 색이 먼저(bodyColor) */
export function orchColor(name: string): string {
  const num = avatarKey(name).match(/(\d+)$/)?.[1];
  const i = num ? Number(num) - 1 : 0;
  return ORCH_COLORS[((i % ORCH_COLORS.length) + ORCH_COLORS.length) % ORCH_COLORS.length]!;
}

/** 설정 음성 명령에서 기본 목소리 — 앱의 Supertonic 실행기일 때만(Rust tts::with_voice 와 같은 판단).
 *  macOS say·직접 입력(local-say 는 -v 가 OpenAI)이면 undefined = 참모 목소리를 못 바꾼다 */
export function baseVoice(ttsCommand: string): Voice | undefined {
  const [prog, ...rest] = ttsCommand.trim().split(/\s+/);
  if (!prog || !/\/tts\/supertonic\/speak(\.cmd)?$/.test(prog.replace(/\\/g, '/'))) return undefined;
  const v = rest[rest.indexOf('-v') + 1];
  return rest.includes('-v') && VOICES.includes(v as Voice) ? (v as Voice) : 'M1';
}

/** 기본 배정 — 설정 목소리가 첫 참모, 번호마다 남·여 번갈아(서로 잘 갈리게). 열 개 넘으면 처음부터 */
const ALT: Voice[] = ['M1', 'F1', 'M2', 'F2', 'M3', 'F3', 'M4', 'F4', 'M5', 'F5'];
export function defaultVoice(key: string, base: Voice): Voice {
  const num = key.match(/(\d+)$/)?.[1];
  const n = num ? Number(num) - 1 : 0;
  return ALT[(ALT.indexOf(base) + n) % ALT.length]!;
}

/** 들어 보기 문장 — "안녕, 나는 개발 담당이야"(받침 있으면 이야, 없으면 야). 숫자는 읽는 소리로(7 = 칠 → 이야) */
export function helloLine(name: string): string {
  const n = name.trim();
  const last = n.slice(-1);
  const c = last.charCodeAt(0);
  const batchim = /\d/.test(last) ? '013678'.includes(last) : c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return tr(`안녕, 나는 ${n}${batchim ? '이야' : '야'}`, `Hi, I'm ${n}`);
}

/** 그 참모 목소리 — 프로필에서 고른 것, 없으면 기본 배정 */
export function voiceFor(saved: Map<string, AvatarEntry>, name: string, base: Voice): Voice {
  const key = avatarKey(name);
  return saved.get(key)?.avatar.voice ?? defaultVoice(key, base);
}

/** 그 참모의 색 — 프사에서 고른 색이 있으면 그것(채팅 칸도 같은 색), 없으면 순서 색 */
export function bodyColor(saved: Map<string, AvatarEntry>, name: string, fallback: string): string {
  const a = saved.get(avatarKey(name))?.avatar;
  return a?.kind === 'preset' && a.color ? a.color : fallback;
}

/** 가로·세로 상한 — 5MB 안이라도 아주 큰 그림(압축 폭탄)은 그릴 때 메모리를 터뜨린다 */
export const MAX_SIDE = 4096;
export function checkSize(w: number, h: number): string | null {
  return w > 0 && h > 0 && w <= MAX_SIDE && h <= MAX_SIDE ? null : tr(`가로·세로 ${MAX_SIDE}px 까지 올릴 수 있어요`, `Up to ${MAX_SIDE}px on each side`);
}

/** 올리기 전 미리 거르기 — 진짜 검사는 Rust 가 첫 바이트로 한다 */
export function checkUpload(f: { type: string; size: number }): string | null {
  if (!IMAGE_TYPES.includes(f.type)) return tr('PNG·JPG·GIF·WebP 만 올릴 수 있어요', 'Only PNG, JPG, GIF or WebP');
  if (f.size <= 0 || f.size > MAX_IMAGE) return tr('5MB 까지 올릴 수 있어요', 'Up to 5 MB');
  return null;
}

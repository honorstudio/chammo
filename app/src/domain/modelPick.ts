// 채팅 머리줄의 모델·에포트 칩 — 지금 값은 상태줄이 남긴 ctx 파일(domain/ctx)에서(2026-10-01 사용자: 터미널에 가서 /model 을 쳐야 해서 UI 로 붙여 달라).
// 바꾸기는 /model 을 인자 없이 쳐서 고르는 창을 열고, 화살표로 모델·에포트를 맞춘 뒤 `s`(이 세션만)로 확정한다.
// ⚠️ `/model opus`·`/effort low` 처럼 인자를 주거나 번호키·Enter 로 확정하면 "새 세션 기본값"까지 ~/.claude/settings.json 에 저장돼 버린다(실측).
// 판단(화면 읽기·눌러야 할 키)만 여기, 키를 보내는 건 ui/chat/modelPickRun.ts

import { tr } from '../i18n';

export type Family = 'opus' | 'sonnet' | 'haiku' | 'other';

/** 모델 id(claude-opus-5-5)나 표시 이름(Opus 5.5 (1M context))에서 계열 */
export function familyOf(name?: string): Family {
  const n = (name ?? '').toLowerCase();
  if (n.includes('opus')) return 'opus';
  if (n.includes('sonnet')) return 'sonnet';
  if (n.includes('haiku')) return 'haiku';
  return 'other';
}

/** 별칭은 항상 그 계열의 최신 모델로 풀린다 */
export const MODEL_CHOICES: { alias: 'opus' | 'sonnet' | 'haiku'; label: string }[] = [
  { alias: 'opus', label: 'Opus' },
  { alias: 'sonnet', label: 'Sonnet' },
  { alias: 'haiku', label: 'Haiku' },
];

export type EffortChoice = { level: string; disabled: boolean; why?: string };

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** 이 모델에서 고를 수 있는 에포트 단계. 하이쿠·모르는 모델은 에포트를 안 만진다(빈 배열) */
export function effortChoices(family: Family): EffortChoice[] {
  if (family !== 'opus' && family !== 'sonnet') return [];
  return LEVELS.map((level) => (family === 'sonnet' && level === 'xhigh'
    ? { level, disabled: true, why: tr('소넷 xhigh 는 토큰을 많이 쓰고 high 보다 낫지 않아요 — high 까지만', 'Sonnet at xhigh uses many more tokens without beating high — up to high') }
    : { level, disabled: false }));
}

/** 칩에 쓸 글 — "Sonnet 5.5 · high". 값이 없으면 칩을 안 그린다(null) */
export function modelChip(c?: { model?: string; effort?: string }): string | null {
  if (!c?.model) return null;
  return c.effort ? `${c.model} · ${c.effort}` : c.model;
}

export type PickerRow = { n: number; name: string };
export type PickerView = { rows: PickerRow[]; cursor: number; effort?: string; effortOk: boolean };

const SLIDER = ['low', 'medium', 'high', 'xhigh', 'max'];

/** /model 고르는 창 화면(터미널 글자 줄들) 읽기. 창이 아니면 null. cursor = rows 안 번호(❯ 가 있는 줄) */
export function parsePicker(lines: string[]): PickerView | null {
  if (!lines.some((l) => l.includes('Select model'))) return null;
  const rows: PickerRow[] = [];
  let cursor = -1;
  for (const l of lines) {
    const m = l.match(/^\s*(?:([❯↓↑])\s+)?(\d+)\.\s+(.+?)(?:\s{2,}|$)/);
    if (!m) continue;
    if (m[1] === '❯') cursor = rows.length;
    rows.push({ n: Number(m[2]), name: m[3]!.replace(/\s*✔\s*$/, '').trim() });
  }
  if (rows.length === 0 || cursor < 0) return null;
  const e = lines.map((l) => l.match(/(Low|Medium|High|xHigh|Max) effort/i)?.[1]?.toLowerCase()).find(Boolean);
  const effortOk = !lines.some((l) => /Effort not supported/i.test(l)) && e !== undefined;
  return { rows, cursor, effort: effortOk ? e : undefined, effortOk };
}

/** 커서를 그 계열(이름 있는 첫 줄 — Default 줄 말고)로 옮길 화살표. 목록에 없으면 null */
export function modelMoves(v: PickerView, family: 'opus' | 'sonnet' | 'haiku'): ('UP' | 'DOWN')[] | null {
  const label = MODEL_CHOICES.find((m) => m.alias === family)!.label.toLowerCase();
  const at = v.rows.findIndex((r) => r.name.toLowerCase().startsWith(`${label} `) || r.name.toLowerCase() === label);
  if (at < 0) return null;
  const d = at - v.cursor;
  return Array<'UP' | 'DOWN'>(Math.abs(d)).fill(d > 0 ? 'DOWN' : 'UP');
}

/** 에포트 슬라이더 — → 로 low→medium→high→xhigh→max→low 로 돈다. 가까운 쪽으로 */
export function effortMoves(cur: string | undefined, want: string): ('LEFT' | 'RIGHT')[] | null {
  const c = cur ? SLIDER.indexOf(cur) : -1;
  const w = SLIDER.indexOf(want);
  if (c < 0 || w < 0) return null;
  const n = (w - c + SLIDER.length) % SLIDER.length;
  return n <= SLIDER.length / 2 ? Array<'RIGHT'>(n).fill('RIGHT') : Array<'LEFT'>(SLIDER.length - n).fill('LEFT');
}

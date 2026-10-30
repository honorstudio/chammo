// 채팅 머리줄의 모델·에포트 칩 — 지금 값은 상태줄이 남긴 ctx 파일(domain/ctx)에서(2026-10-01 사용자: 터미널에 가서 /model 을 쳐야 해서 UI 로 붙여 달라).
// 바꾸기는 `/model sonnet`·`/effort high` 를 치고, 그 명령이 ~/.claude/settings.json 에 적는 "새 세션 기본값"은 앱이 되돌린다(ui/chat/modelPickRun, 2026-10-01 실측).
// parsePicker 등은 예전 방식(고르는 창 화살표)이 남긴 창을 알아보는 데만 쓴다.
// 판단(화면 읽기·눌러야 할 키)만 여기, 키를 보내는 건 ui/chat/modelPickRun.ts

import { tr } from '../i18n';

export type Family = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other';

/** 모델 id(claude-opus-5-5)나 표시 이름(Opus 5.5 (1M context))에서 계열 */
export function familyOf(name?: string): Family {
  const n = (name ?? '').toLowerCase();
  if (n.includes('opus')) return 'opus';
  if (n.includes('sonnet')) return 'sonnet';
  if (n.includes('haiku')) return 'haiku';
  if (n.includes('fable')) return 'fable';
  return 'other';
}

export type ModelOpt = { id: string; label: string };
type Info = { model?: string; modelId?: string };

/** 칩 첫 줄 — 계열마다 가장 새 판. 전체 id 로 친다(`/model claude-opus-5-5`): 별칭은 Claude Code 판마다 풀리는 곳이 달라
 *  (10-01 엔 haiku = 4.5) 칩 글과 어긋났고, 계열만 보면 안전 분류기가 세션을 Opus 4.8 로 떨어뜨려도 "이미 Opus" 라며 안 바꿨다(2026-10-29 사용자).
 *  목록은 Claude Code 2.1.312 /model 창 그대로(.shots/model-pick/picker-2.1.312.txt) — 새 판이 나오면 여기와 OTHER_MODELS 를 고친다 */
export const MODEL_CHOICES: (ModelOpt & { alias: 'opus' | 'sonnet' | 'haiku' })[] = [
  { alias: 'opus', id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { alias: 'sonnet', id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { alias: 'haiku', id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
];

/** '그 밖' 접기 — /model 창의 나머지 줄 순서 그대로 */
export const OTHER_MODELS: ModelOpt[] = [
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
];

const ALL_MODELS: ModelOpt[] = [...MODEL_CHOICES, ...OTHER_MODELS];
/** 채팅에서 친 별칭 — 칩 칸의 전체 id 로 */
const ALIASES: Record<string, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-1' };

/** 칩이 칠 수 있는 id 인가(폰 요청·채팅 명령 검사) */
export const isModelId = (v: unknown): v is string => ALL_MODELS.some((m) => m.id === v);

/** 지금 모델이 그 칸인가 — 판까지 같아야. id 는 날짜 꼬리(-20251001)·[1m] 만 같은 모델로, id 가 없으면 표시 이름(괄호 꼬리 뗀 것)으로 */
export function isModel(info: Info | undefined, id: string): boolean {
  if (info?.modelId) {
    const rest = info.modelId.slice(id.length);
    return info.modelId.startsWith(id) && (rest === '' || /^(-\d{8}|\[)/.test(rest));
  }
  const label = ALL_MODELS.find((m) => m.id === id)?.label;
  return !!label && (info?.model ?? '').replace(/\s*\(.*\)\s*$/, '').trim() === label;
}

/** 지금 모델의 칸 — 목록에 없으면 undefined */
export const modelOf = (info?: Info): ModelOpt | undefined => ALL_MODELS.find((m) => isModel(info, m.id));

export type EffortChoice = { level: string; disabled: boolean; why?: string };

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** 이 모델에서 고를 수 있는 에포트 단계. Haiku 4.5("Effort not supported", 2026-10-29 실측)·모르는 모델은 에포트를 안 만진다(빈 배열) */
export function effortChoices(info?: Info): EffortChoice[] {
  const family = familyOf(info?.modelId ?? info?.model);
  if (family === 'other' || isModel(info, 'claude-haiku-4-5')) return [];
  // 소넷 xhigh 는 막던 것을 풀었다 — 고를 수 있고 안내만 남긴다(공개판 사용자에겐 제약이었다, 2026-10-01 사용자)
  return LEVELS.map((level) => (family === 'sonnet' && level === 'xhigh'
    ? { level, disabled: false, why: tr('소넷 xhigh 는 토큰을 많이 쓰는 데 비해 high 보다 크게 낫지 않을 수 있어요', 'Sonnet at xhigh uses many more tokens and may not beat high by much') }
    : { level, disabled: false }));
}

/** 칩에 쓸 글 — "Sonnet 5.5 · high". 값이 없으면 칩을 안 그린다(null) */
export function modelChip(c?: { model?: string; effort?: string }): string | null {
  if (!c?.model) return null;
  return c.effort ? `${c.model} · ${c.effort}` : c.model;
}

/** 폰 입력창 칩 — 가장 새 판이면 "Opus · high"(판 번호는 시트 머리에서만), 옛 판·그 밖이면 "Opus 4.8 · high"(떨어진 걸 알아보게),
 *  모르는 모델은 첫 낱말. 값이 없으면 null */
export function modelChipShort(c?: { model?: string; modelId?: string; effort?: string }): string | null {
  if (!c?.model) return null;
  const name = MODEL_CHOICES.find((m) => isModel(c, m.id))?.label.split(' ')[0] ?? modelOf(c)?.label ?? c.model.split(/\s+/)[0]!;
  return c.effort ? `${name} · ${c.effort}` : name;
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
  const at = v.rows.findIndex((r) => r.name.toLowerCase().startsWith(`${family} `) || r.name.toLowerCase() === family);
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

/** /model 뒤 "Switch model?" 확인 창(대화가 길면 캐시를 다시 읽는다고 묻는다)인가 — 1번(Yes)이 고른 자리에 있을 때만 */
export function switchConfirm(lines: string[]): boolean {
  return lines.some((l) => l.includes('Switch model?')) && lines.some((l) => /^\s*❯\s*1\.\s*Yes/.test(l));
}

/** 친 명령(`/model sonnet`·`/effort high`)의 결과 — 그 명령을 마지막으로 친 줄 바로 아래 ⎿ 줄. 아직 없으면 null.
 *  예전에 같은 명령을 쳤어도 마지막 것만 본다 */
export function commandResult(lines: string[], cmd: string): { ok: boolean; text: string } | null {
  let at = -1;
  lines.forEach((l, i) => { if (l.replace(/^\s*[❯>]\s*/, '').trim() === cmd) at = i; });
  if (at < 0) return null;
  for (const l of lines.slice(at + 1)) {
    const m = l.match(/^\s*⎿\s+(.+)$/);
    if (!m) continue;
    const text = m[1]!.trim();
    return { ok: /^(Set model to|Kept model as|Set effort level to|Kept effort)/.test(text), text };
  }
  return null;
}

/** 채팅에서 친 /model·/effort — 칩으로 돌린다(open = 칩 메뉴 열기, want = 그 값으로 바꾸기). 아니면 null(그대로 보낸다).
 *  터미널의 /model 고르는 창은 보낸 Enter 가 창을 바로 골라 지금 모델이 기본값으로 저장됐다(2026-10-01 시험) */
export function modelCommand(text: string): { open: true } | { want: { model?: string; effort?: string } } | null {
  const t = text.trim();
  if (t.includes('\n')) return null;
  const m = t.match(/^\/(model|effort)(?:\s+(\S+))?$/i);
  if (!m) return null;
  const arg = m[2]?.toLowerCase();
  if (!arg) return { open: true };
  if (m[1]!.toLowerCase() === 'model') { const id = ALIASES[arg] ?? arg; return isModelId(id) ? { want: { model: id } } : null; }
  return LEVELS.includes(arg) ? { want: { effort: arg } } : null;
}

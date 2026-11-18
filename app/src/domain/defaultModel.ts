// 새 세션 기본 모델·노력값(설정 > 참모 · 폰 더보기) — 값은 앱 config(defaultModel·defaultEffort), 앱이 띄우는 세션에만 붙는다(Rust default_model.rs).
// 빈 값 = Claude Code 기본(~/.claude/settings.json)을 따름 — 첫 칸 '기본 (Opus 5.5)'에 그 전역 값을 보여 준다
import { tr } from '../i18n';
import { MODEL_CHOICES, OTHER_MODELS, effortChoices, familyOf } from './modelPick';

/** Rust default_model::view 모양 */
export type DefaultModelView = { model: string; effort: string; models: string[]; efforts: string[]; userModel: string; userEffort: string };
export type Opt = { value: string; label: string };

/** 별칭 → 그 계열 가장 새 판(칩 목록과 같은 이름) */
const ID: Record<string, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-2' };
const label = (alias: string) => [...MODEL_CHOICES, ...OTHER_MODELS].find((m) => m.id === ID[alias])?.label ?? alias;

/** 그 별칭이 받는 노력값 — 빈 값(기본 따름)이면 전부 */
export function effortsFor(alias: string): string[] {
  const all = ['low', 'medium', 'high', 'xhigh', 'max'];
  return alias ? effortChoices({ modelId: ID[alias] }).map((c) => c.level) : all;
}

/** 모델을 바꿨는데 고른 노력값을 그 모델이 안 받으면 기본으로 */
export const fixEffort = (alias: string, effort: string) => (effortsFor(alias).includes(effort) ? effort : '');

/** '기본 (Opus 5.5 · high)' — 전역 settings.json 의 값(별칭·전체 id 둘 다) */
export function followLabel(userModel: string, userEffort: string): string {
  const fam = familyOf(userModel);
  const name = fam === 'other' ? userModel : label(fam);
  const inside = [name, userEffort].filter(Boolean).join(' · ');
  return inside ? tr(`기본 (${inside})`, `Default (${inside})`) : tr('기본', 'Default');
}

export const modelOptions = (v: DefaultModelView): Opt[] => [
  { value: '', label: followLabel(v.userModel, '') },
  ...v.models.map((m) => ({ value: m, label: label(m) })),
];

export const effortOptions = (v: DefaultModelView, alias: string): Opt[] => [
  { value: '', label: v.userEffort ? tr(`기본 (${v.userEffort})`, `Default (${v.userEffort})`) : tr('기본', 'Default') },
  ...effortsFor(alias).filter((e) => v.efforts.includes(e)).map((e) => ({ value: e, label: e })),
];

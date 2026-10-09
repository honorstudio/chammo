// 폰 프로필 창 — 모양·눈·색·목소리(2026-10-09, 그전엔 이름만). 그림은 폰에서 못 올린다: 그림 프로필이면 그림 그대로 두고 목소리만,
// 기본형을 고르면 기본형으로(그림은 맥이 지운다). 저장은 폰 서버 /api/avatar → 데스크톱 프로필 창과 같은 Rust avatar::save_in
import type { Avatar, Preset, Voice } from './avatar';

/** kind = 지금 고른 것 — 'image' 는 이미 올린 그림을 그대로 쓴다는 뜻 */
export type ProfileDraft = { kind: 'preset' | 'image'; preset: Preset; voice: Voice | null };

const CIRCLE: Preset = { kind: 'preset', shape: 'circle', eyes: 'pill', color: null };

/** 창을 열 때 — 저장소 값(없으면 기본 배정 모양)에서 시작 */
export function profileDraft(start: Avatar): ProfileDraft {
  if (start.kind === 'image') return { kind: 'image', preset: CIRCLE, voice: start.voice ?? null };
  const { voice, ...preset } = start;
  return { kind: 'preset', preset, voice: voice ?? null };
}

/** 저장할 프로필 — 안 건드렸으면 null(저장한 적 없는 참모에 처음 모양 파일이 생기지 않게, 데스크톱 AvatarPicker 와 같은 판단) */
export function profileToSave(start: Avatar, d: ProfileDraft): Avatar | null {
  const was = profileDraft(start);
  const same = d.kind === was.kind && d.voice === was.voice && (d.kind === 'image' || JSON.stringify(d.preset) === JSON.stringify(was.preset));
  if (same) return null;
  if (d.kind === 'image') return start.kind === 'image' ? { kind: 'image', file: '', crop: start.crop, voice: d.voice } : null;
  return { ...d.preset, voice: d.voice };
}

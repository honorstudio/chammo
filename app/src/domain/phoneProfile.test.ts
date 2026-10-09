import { describe, expect, it } from 'vitest';
import { profileDraft, profileToSave, type ProfileDraft } from './phoneProfile';
import type { Avatar, Preset } from './avatar';

const P = (o: Partial<Preset> = {}): Preset => ({ kind: 'preset', shape: 'star', eyes: 'pill', color: null, ...o });
const IMG: Avatar = { kind: 'image', file: '참모-2.png', crop: { zoom: 1.5, x: 0.2, y: 0 }, voice: 'F1' };

describe('profileDraft — 폰 프로필 창 처음 값(2026-10-09)', () => {
  it('기본형이면 그 모양, 그림이면 그림 그대로 두고 기본형 칸은 동그라미로', () => {
    expect(profileDraft(P({ color: '#2f74e0', voice: 'M2' }))).toEqual({ kind: 'preset', preset: P({ color: '#2f74e0' }), voice: 'M2' });
    expect(profileDraft(IMG)).toEqual({ kind: 'image', preset: { kind: 'preset', shape: 'circle', eyes: 'pill', color: null }, voice: 'F1' });
  });
});

describe('profileToSave — 무엇을 저장하나(null = 저장 안 함)', () => {
  const d = (o: Partial<ProfileDraft>): ProfileDraft => ({ kind: 'preset', preset: P(), voice: null, ...o });
  it('안 건드렸으면 저장 안 한다 — 저장한 적 없는 참모에 처음 모양 파일이 생기지 않게(데스크톱과 같은 판단)', () => {
    expect(profileToSave(P(), d({}))).toBeNull();
    expect(profileToSave(IMG, d({ kind: 'image', voice: 'F1' }))).toBeNull();
  });
  it('기본형 — 모양·색·목소리 그대로 보낸다(목소리 없음은 null)', () => {
    expect(profileToSave(P(), d({ preset: P({ shape: 'cloud', color: '#1f9a62' }) }))).toEqual({ kind: 'preset', shape: 'cloud', eyes: 'pill', color: '#1f9a62', voice: null });
    expect(profileToSave(P(), d({ voice: 'F3' }))).toEqual({ ...P(), voice: 'F3' });
  });
  it('그림 프로필 — 그림 그대로면 자르기는 있던 값, 목소리만 바꾼다(그림 이름은 맥이 정한다)', () => {
    expect(profileToSave(IMG, d({ kind: 'image', voice: 'M4' }))).toEqual({ kind: 'image', file: '', crop: { zoom: 1.5, x: 0.2, y: 0 }, voice: 'M4' });
    // 기본형으로 바꾸면 그림은 맥이 지운다
    expect(profileToSave(IMG, d({ kind: 'preset', voice: 'F1' }))).toEqual({ ...P(), voice: 'F1' });
  });
  it('그림이 없는데 그림을 고를 수는 없다', () => {
    expect(profileToSave(P(), d({ kind: 'image' }))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { doingLine, handbackLine, handbackTargets, mirrorNote, saveState, takeButton, type CraftInfo } from './craftWin';

const info = (o: Partial<CraftInfo> = {}): CraftInfo => ({ name: 'PhotoCraft', version: '0.9.0', pid: 4242, last: '', dirty: false, mirror: 'live', takeover: false, ...o });

describe('Craft 따로 창 머리줄·아래 줄', () => {
  it('저장 상태는 글로 — 바뀐 게 있으면 노란 점과 닫으면 저장(묻지 않고 저장 후 닫기)', () => {
    expect(saveState(info({ dirty: true }))).toEqual({ text: '닫으면 저장', dirty: true });
    expect(saveState(info())).toEqual({ text: '저장됨', dirty: false });
  });

  it('아래 줄은 참모가 마지막으로 한 일', () => {
    expect(doingLine(info({ last: '채도 +40' }))).toBe('참모 · 채도 +40');
    expect(doingLine(info())).toBe('참모가 다루는 중');
    expect(doingLine(info({ pid: null }))).toBe('앱이 꺼져 있어');
  });

  it('개입 중이면 아래 줄이 그 말, 머리줄 단추는 돌려주기', () => {
    expect(doingLine(info({ takeover: true, last: '채도 +40' }))).toContain('직접 조작 중');
    expect(takeButton(info())).toEqual({ text: '개입', on: true });
    expect(takeButton(info({ takeover: true }))).toEqual({ text: '돌려주기', on: false });
  });

  it('돌려받을 때 참모 입력칸 한 줄', () => {
    expect(handbackLine('PhotoCraft', "'Hue/Saturation 1' 채도 40→75 · 작업 내역 +1(Modify Adjustment)")).toMatch(/^\[앱\] PhotoCraft 돌려받음 — 사람이 바꾼 것: 'Hue\/Saturation 1' 채도 40→75 · 작업 내역 \+1\(Modify Adjustment\)/);
    expect(handbackLine('PhotoCraft', '')).toMatch(/^\[앱\] PhotoCraft 돌려받음 — 사람이 바꾼 것: 바뀐 것 없음/);
  });

  it('돌려받으면 남은 스크립트를 스스로 다시 돌리지 말고 사람에게 묻게(2026-10-19 사용자 "돌려줬을 때 어떤 상황인지 알고 이어받아서 명령을 기다려야")', () => {
    const l = handbackLine('PhotoCraft', '바뀐 것 없음');
    expect(l).toMatch(/다시 돌리지 말고/);
    expect(l).toMatch(/사람에게/);
    expect(l).not.toMatch(/\n/);
  });

  it('비추기가 안 될 때만 칸 가운데 안내', () => {
    expect(mirrorNote(info())).toBeNull();
    expect(mirrorNote(info({ mirror: 'waiting' }))?.text).toContain('비추는 중');
    const perm = mirrorNote(info({ mirror: 'no-permission' }));
    expect(perm?.text).toContain('화면 기록');
    expect(perm?.settings).toBe(true); // 권한 열기 단추
    expect(mirrorNote(info({ mirror: 'no-window' }))?.settings).toBe(false);
    expect(mirrorNote(info({ mirror: 'not-built' }))?.text).toContain('이 빌드');
  });
});

describe('돌려받음 [앱] 줄 받는 참모(2026-10-19 — 회사 비서 탭에서 개입했는데 참모-2 에게 감)', () => {
  it('그 칸이 떠 있는 참모 탭 → 연 참모 → 대표 참모, 겹치면 한 번', () => {
    expect(handbackTargets('orch-b', 'orch-c', 'orch-a')).toEqual(['orch-b', 'orch-c', 'orch-a']);
    expect(handbackTargets(undefined, 'orch-c', 'orch-a')).toEqual(['orch-c', 'orch-a']);
    expect(handbackTargets('orch-a', '', 'orch-a')).toEqual(['orch-a']);
    expect(handbackTargets(undefined, undefined, undefined)).toEqual([]);
  });
});

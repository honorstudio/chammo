import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PHONE_PART, PHONE_MAX, partsOf, upId } from './teamPhoneUp';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('폰 → 팀 보관함 올리기 조각(Rust team_phone_up 과 같은 크기)', () => {
  it('조각 크기·상한이 맥과 같다', () => {
    const rs = src('../../src-tauri/src/team_phone_up.rs');
    expect(PHONE_PART).toBe(4 * 1024 * 1024);
    expect(rs).toContain('pub const PART: usize = 4 * 1024 * 1024;');
    expect(PHONE_MAX).toBe(1024 * 1024 * 1024);
    expect(rs).toContain('pub const MAX_TOTAL: u64 = 1024 * 1024 * 1024;');
  });
  it('조각 수 — 빈 파일도 한 조각, 넘으면 null', () => {
    expect(partsOf(0)).toBe(1);
    expect(partsOf(1)).toBe(1);
    expect(partsOf(PHONE_PART)).toBe(1);
    expect(partsOf(PHONE_PART + 1)).toBe(2);
    expect(partsOf(PHONE_MAX)).toBe(256);
    expect(partsOf(PHONE_MAX + 1)).toBeNull();
  });
  it('올림 id 는 맥이 받는 모양(영문 소문자·숫자·-, 8~40)', () => {
    for (let k = 0; k < 20; k++) expect(upId()).toMatch(/^[a-z0-9-]{8,40}$/);
    expect(upId()).not.toBe(upId());
  });
});

describe('폰 팀 보관함 배선 — 중계 목록과 데스크톱 같은 규칙(10-28 사용자)', () => {
  const ui = src('../ui/mobile/PhoneTeamLocker.tsx');
  const team = src('../ui/mobile/PhoneTeam.tsx');
  const web = src('../data/web.ts');
  it('맥에 내려받은 팀 폴더(/api/locker)가 아니라 중계 팀 보관함(/api/team-locker)을 읽는다', () => {
    expect(team).not.toContain('readLocker');
    expect(team).toContain('<PhoneTeamLocker ');
    expect(web).toContain("`/api/team-locker?team=");
    expect(ui).toContain('api.locker(');
    expect(ui).toContain('inPlace(');
    expect(ui).toContain('kidFolders(');
  });
  it('관리 — 새 폴더·이름·옮기기·휴지통·되살리기만(영구 지우기는 데스크톱)', () => {
    for (const op of ["'mkdir'", "'rename'", "'move'", "'trash'", "'restore'", "'folder-rename'", "'folder-trash'"]) expect(ui).toContain(op);
    expect(ui).not.toContain('purge');
    expect(web).toContain("'/api/team-locker-op'");
    expect(web).toContain('/api/team-locker-put?');
    expect(web).toContain("'application/octet-stream'");
  });
  it('시트는 kit BottomSheet(시트 자리 안), 큰 파일은 한 줄 안내', () => {
    expect(ui).toContain("from './BottomSheet'");
    expect(ui).not.toMatch(/position:\s*fixed/);
    expect(ui).toContain('partsOf(');
  });
});

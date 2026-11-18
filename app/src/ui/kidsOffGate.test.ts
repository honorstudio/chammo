import { describe, expect, it } from 'vitest';
import setup from './Setup.tsx?raw';
import kids from '../../src-tauri/src/kids.rs?raw';

// 0.4.16 공개판은 키즈 모드를 뺀다 — 이미 켜 둔 사람(저장된 설정 kids:true)만 설정 > 기능에서 칸을 본다
describe('키즈 모드 칸은 이미 켠 사람에게만', () => {
  it('설정 기능 스위치 목록에 kids 는 저장된 설정이 켜졌을 때만 들어간다', () => {
    expect(setup).toMatch(/\.\.\.\(config\.features\.kids \? \['kids' as const\] : \[\]\)/);
    expect(setup).not.toMatch(/'craftBasics', 'kids', 'usagePing'/);
  });
  it('첫 설치 기능 고르기에도 kids 는 없다', () => {
    expect(setup).toMatch(/features\(\)\.filter\(\(\[k\]\) => k !== 'kids'\)/);
  });
});

describe('키즈 명령은 설정이 꺼져 있으면 거절한다(읽기만 예외)', () => {
  const cmds = kids.split('#[tauri::command]').slice(1).map((b) => b.split(/\n#\[|\n\/\/\/ /)[0] ?? b);
  it('명령을 다 찾았다', () => {
    expect(cmds.length).toBeGreaterThanOrEqual(15);
  });
  for (const body of cmds) {
    const name = /pub async fn (\w+)/.exec(body)?.[1] ?? '?';
    if (name === 'kids_read') continue; // on:false 를 돌려줘 화면이 칸을 숨긴다
    it(`${name} 은 스위치를 본다`, () => {
      expect(body).toMatch(/need_on\(\)|kid_ready\(|switch_on\(\)/);
    });
  }
});

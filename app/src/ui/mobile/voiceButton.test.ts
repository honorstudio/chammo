// 폰 음성 모드 단추 — 말하면 받아 적는 단추로 헷갈리지 않게 데스크톱처럼 스피커, 켜짐은 꽉 찬 색 (2026-10-11 사용자 폰)
import { describe, expect, it } from 'vitest';
import css from './mobile.css?raw';
import extras from './ComposerExtras.tsx?raw';

const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`${sel} 규칙 없음`);
  return m[1]!;
};

describe('폰 음성 모드 단추', () => {
  it('스피커 아이콘이고 마이크는 안 쓴다', () => {
    expect(extras).toMatch(/IconSpeaker/);
    expect(extras).not.toMatch(/IconMic/);
  });
  it('켜짐은 옅은 파랑이 아니라 참모 색 꽉 찬 면', () => {
    const r = rule('.m-cbtn.m-on > .m-cdot');
    expect(r).toMatch(/--orch-solid/);
    expect(r).not.toMatch(/tag-working/);
  });
  it('이름은 마이크가 아니라 음성 모드', () => {
    expect(extras).not.toMatch(/VoiceMic/);
    expect(extras).toMatch(/VoiceMode/);
  });
});

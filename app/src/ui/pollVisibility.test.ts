// 폴링 규칙(10-31 팀 성능) — DOM 없이 소스로. 안 보이는 창은 every(5배 늦춤, 10-11 사용자 승인)를 따르고, 꺼진 기능은 안 묻는다
import { describe, expect, it } from 'vitest';
import locker from './team/TeamLocker.tsx?raw';
import cal from './team/useTeamCal.ts?raw';
import tama from './tama/useTama.ts?raw';
import app from '../App.tsx?raw';

describe('폴링은 보임을 따른다', () => {
  // 로그인 문은 '사람을 부르는 길'이라 늦추지 않는다(ui/poll.ts 머리, 10-11) — 여기서 뺀다
  it('팀 보관함·캘린더는 setInterval 대신 every', () => {
    for (const [name, src] of [['TeamLocker', locker], ['useTeamCal', cal]] as const) {
      expect(src, name).not.toMatch(/setInterval\(/);
      expect(src, name).toMatch(/every\(/);
    }
  });
  it('다마고치를 끄면 위젯 폴링(초당 둘)을 안 한다', () => {
    expect(tama).toMatch(/if \(!widget\) return;/);
    expect(app).toMatch(/useTama\(.*, features\.tama\);/);
  });
});

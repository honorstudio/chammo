import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 11-01 사용자 "윈도우인데 '맥에서 받는다'고 써 있다 — 맥·윈도우라는 텍스트가 써 있는 것 자체도 문제" —
// 팀 파일 받기·내 보관함·파일 탭처럼 두 플랫폼에서 똑같이 보이는 파일 화면 문구엔 플랫폼 이름을 안 쓴다(기기 이름·맥 전용 설정 화면은 따로)
const FILES = [
  'ui/team/TeamLocker.tsx', 'ui/team/TeamConvo.tsx', 'ui/team/RoomBits.tsx', 'ui/team/TeamHome.tsx',
  'ui/chat/ChatFileCard.tsx', 'ui/space/Preview.tsx', 'ui/space/FileTab.tsx', 'ui/space/lockerMenuItems.ts',
  'ui/space/LockerPage.tsx', 'ui/space/ProjectView.tsx',
];
const PLATFORM = /맥|윈도우|파인더|탐색기|\bMac\b|macOS|Windows|Finder|Explorer/;
const TR = /tr\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*(['"`])((?:\\.|(?!\3).)*)\3/gs;

describe('파일 화면 문구에 플랫폼 이름 없음', () => {
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(join(__dirname, '..', '..', f), 'utf8');
      const bad = [...src.matchAll(TR)].map((m) => `${m[2]} || ${m[4]}`).filter((t) => PLATFORM.test(t));
      expect(bad).toEqual([]);
    });
  }
});

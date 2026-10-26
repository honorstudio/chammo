import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';

// 2026-10-25 사용자: 회사 비서에게 말했는데 개발 담당도 자기 보고를 읽어 둘이 같이 말했다 — 소리는 말 건 참모만, 나머지는 쌓고 한 줄
describe('음성은 말 건 참모만 — App 이 새 답마다 거른다', () => {
  it('새 답은 talkedTo(사람이 마지막으로 말한 참모 + 앞 채팅 탭)로 가른 뒤 routeReply 로 — 읽기·한 줄·쌓기', () => {
    expect(app).toMatch(/const speakers = talkedTo\(orchActs\.map\(\(x\) => \(\{ id: x\.session\.id, human: x\.activity\.human \}\)\), front\)/);
    expect(app).toMatch(/routeReply\(voiceHeld\.current, \{ id: s\.id, name: orchDisplay\(s\) \|\| assistant\(\), text: t, asks: !!f\.reply\.asks/);
    expect(app).toMatch(/if \(o\.note\) return speak\(o\.note, undefined, s\.id\);\n\s*return o\.speak \? speakAs\(s, o\.speak\) : undefined;/); // 읽는 건 routeReply 가 고른 것만
  });
  it('채팅 탭을 열면 쌓인 답을 읽고, scripts/app voice read 도 같은 길', () => {
    expect(app).toMatch(/useEffect\(\(\) => \{ if \(chatTab\) readHeld\(chatTab\); \}, \[chatTab\]\)/);
    expect(app).toMatch(/it\.kind === 'voiceRead'[\s\S]{0,200}readHeld\(id, true\)/);
  });
  it('음성 모드를 끄면 쌓인 답도 비운다(나중에 엉뚱하게 읽지 않게)', () => {
    expect(app).toMatch(/const turnVoice = \(on: boolean\) => setVoice\(\(v\) => \{ if \(!on\) voiceHeld\.current = \{\};/);
  });
});

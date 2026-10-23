// 메신저 화면 연결 — DOM 없이 소스로 지키는 규칙(앱 테스트엔 jsdom 이 없다)
import { describe, expect, it } from 'vitest';
import convo from './TeamConvo.tsx?raw';
import mode from './useTeamMode.tsx?raw';
import rail from './TeamRail.tsx?raw';
import orchRail from '../space/OrchRail.tsx?raw';

describe('메신저 연결', () => {
  it('보내기는 사람 문(teamHumanSay + 이 칸의 진짜 키·클릭 시각)만 — 앱이 저절로 보내는 길이 없다', () => {
    expect(convo).toContain('say = teamHumanSay');
    expect(convo).toContain('say(convo.peer, t, trustedAt.current)');
    expect(convo).toContain('e.nativeEvent.isTrusted ? Date.now() : 0');
    expect(convo).not.toMatch(/invoke\(/);
  });
  it('떼기 아이콘은 모니터가 둘 이상일 때만(모니터 하나면 뗀 창이 스페이스를 가린다)', () => {
    expect(mode).toContain('const canDetach = screens > 1;');
    expect(mode).toContain('onDetachAll={canDetach ?');
    expect(mode).toContain('detach={canDetach ?');
  });
  it('띠 칸은 .lk-strip 바로 아래 형제(.lk-av.tmx) — 고른 자리 이음이 그 칸을 찾고, 참모 순서 바꾸기는 그 칸을 뺀다', () => {
    expect(rail).not.toMatch(/<div className="tmx/);
    expect(rail.match(/className=\{?[`"]lk-av tmx /g)?.length).toBe(3);
    expect(orchRail).toContain(":scope > .lk-av:not(.grp):not(.tmx)");
    expect(orchRail).toContain('{extra}');
  });
  it('보고 있는 대화를 Rust 에 알리고 칸을 떠나면 지운다(그 대화 새 말엔 안 울린다)', () => {
    expect(convo).toContain('viewing = teamViewing');
    expect(convo).toContain('viewing(convo.room)');
    expect(convo).toContain("viewing('')");
  });
});

import phone from '../mobile/PhoneTeam.tsx?raw';
import web from '../../data/web.ts?raw';
describe('폰 팀 탭', () => {
  it('폰 보내기도 진짜 누름 뒤 1.5초 문을 지나고, 읽기·쓰기는 TeamPhoneApi 하나로만(중계 직결로 갈아끼울 자리)', () => {
    expect(phone).toContain('sendAllowed(at, Date.now()) && text.trim() ? api.say(to, text, cidFor(to, text)) : null');
    expect(phone).not.toMatch(/fetch\(|'\/api\/team/);
    expect(web).toContain("say: (to, text, cid) => post('/api/team-say', { to, text, cid })");
  });
});

import locker from './TeamLocker.tsx?raw';
describe('팀 보관함', () => {
  it('보관함을 안 쓴 사람은 누를 때만 시작한다(대화를 고르면 팀 탭이 저절로 열려서)', () => {
    expect(locker).toContain('useLockerTree(teamOwner(teamId, team), 5000, start)');
    expect(locker).toContain('const [start, setStart] = useState(false);');
  });
});

import app from '../../App.tsx?raw';
import messenger from './MessengerApp.tsx?raw';
describe('보안 10-23: 넘기기 세 길은 team_handoff(거름 + 본문 없는 기록)로만', () => {
  it('메인 창·따로 창·폰 모두 team_handoff 길 — sendTextToSession(space-send 기록에 앞 80자)으로 안 간다', () => {
    const appHand = app.slice(app.indexOf('const teamMode = useTeamMode('), app.indexOf('const teamMode = useTeamMode(') + 900);
    expect(appHand).toContain("invoke<string>('team_handoff'");
    expect(appHand).not.toContain('sendTextToSession');
    expect(messenger).toContain("invoke<string>('team_handoff', { text, dry: false })");
    expect(phone).toContain('api.handoff(orch.id, text)');
    expect(phone).not.toContain('sendTextToSession');
    expect(web).toContain("handoff: (to, text) => post('/api/team-handoff', { to, text })");
  });
});

describe('폰 팀 보관함', () => {
  it('팀 폴더는 이름이 아니라 owner id(team-<팀 id>)로 고른다 — 같은 이름의 참모 폴더와 안 섞이게', () => {
    expect(phone).toContain('`team-${teamId}`');
    expect(phone).not.toContain('i.owner === team)');
  });
});

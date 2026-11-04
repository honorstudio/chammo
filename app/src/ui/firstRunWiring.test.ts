import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import gate from './LoginGate.tsx?raw';
import devices from './DevicesSection.tsx?raw';
import setup from './Setup.tsx?raw';

// 2026-11-01 ux-start QA — 첫 설정 뒤 로그인 문·둘러보기·첫 기기 질문
describe('첫 설정 뒤 화면 순서(H1)', () => {
  it('App 은 로그인 문 상태를 받아 둘러보기를 그 뒤에 그린다', () => {
    expect(app).toMatch(/<LoginGate onGate=\{setLoginGate\} \/>/);
    expect(app).toMatch(/tourVisible\(tourOpen, loginGate\) && <Tour /);
  });
  it('LoginGate 는 상태를 못 읽었을 땐 null, 읽은 뒤엔 문 상태를 알린다', () => {
    expect(gate).toMatch(/onGate\?\.\(v \? gate : null\)/);
  });
  it('준비 끝 단계에 계정 예고 줄, 점검의 Claude 로그인 줄은 범위를 좁힌 글', () => {
    expect(setup).toContain('readyAccountNote()');
    expect(setup).toContain('claudeSignedInText()');
  });
});

describe("첫 기기 질문 '나중에'(M1)", () => {
  it('나중에는 계정별로 기억한다', () => {
    expect(gate).toMatch(/laterFor\(/);
    expect(gate).toMatch(/localStorage\.setItem\(START_LATER_KEY/);
  });
  it('설정 > 기기 관리에서 사람이 눌러 시작한다(스크립트 클릭 무시)', () => {
    expect(devices).toMatch(/step === 'start'/);
    expect(devices).toMatch(/isTrusted[^\n]*e2e_start_chain|e2e_start_chain[^\n]*isTrusted/);
  });
});

describe('새 영어 설치 기본 이름(M2)', () => {
  it('첫 설정 마칠 때 firstRunName 으로 이름을 적는다', () => {
    expect(setup).toMatch(/assistantName: firstRunName\(draft\.assistantName, draft\.language\)/);
  });
});

describe('팀 팝업에서 시작(ux-team H2)', () => {
  it("TeamStart 는 만들기·들어가기 화면에 needStart 면 '여기서 시작'을 두고 사람 클릭만 받는다", async () => {
    const team = (await import('./team/TeamStart.tsx?raw')).default;
    expect(team).toMatch(/needStart\(screen, step\)/);
    expect(team).toMatch(/isTrusted[^\n]*e2e_start_chain/);
    expect(team.match(/\{startBox\}/g)?.length).toBe(2);
  });
});

describe('첫 설정 기능 단계는 두 줄만(ux-start M3)', () => {
  it('마법사 기능 단계 = 알림·브라우저 자동화 + 나머지는 설정 > 기능 안내 — 체크 칸·권한·애니메이션은 설정 탭에만', () => {
    const feat = setup.slice(setup.indexOf('const featSec'), setup.indexOf('const readySec'));
    expect(feat).toMatch(/\{notifyBlock\}\{browserBlock\}/);
    expect(feat).not.toMatch(/featGrid|axBlock|screenBlock|animField/);
    expect(feat).toContain('설정 > 기능에서 켤 수 있어요');
  });
});

describe('첫 설정 기본 단계는 폴더+믿기만(ux-start M4)', () => {
  const basics = () => setup.slice(setup.indexOf('const basicsSec'), setup.indexOf('const notifyBlock'));
  it('프로젝트 폴더 바로 아래 믿기, 참모 작업 폴더는 접힌 자세히 안에', () => {
    expect(basics()).toMatch(/\{devField\}\{trustBlock\}/);
    expect(basics()).toMatch(/<details[^>]*>[\s\S]*\{hqField\}[\s\S]*<\/details>/);
  });
  it('참모 이름·따로 둔 프로젝트·GitHub·음성·말하기 키·메모는 설정에서 — 마법사엔 없다', () => {
    expect(basics()).not.toMatch(/nameField|extrasField|githubField|ttsField|talkField|memoField/);
    expect(basics()).toContain('나중에 설정에서 바꿀 수 있어요');
  });
  it("'HQ 폴더' 대신 '참모 작업 폴더'", () => {
    expect(setup).not.toMatch(/tr\('HQ 폴더'|tr\('HQ 폴더 믿기'/);
    expect(setup).toContain("tr('참모 작업 폴더', 'Assistant workspace folder')");
  });
});

describe('위 띠(ux-start M6)', () => {
  it('부하 칩은 늘 보이고(11-01 사용자 "팔로우가 안 됨") 숫자를 칩에 안 띄운다 — 숫자는 올리면 뜨는 카드에', async () => {
    const bar = (await import('./TopBar.tsx?raw')).default;
    expect(bar).toContain('<LoadChip {...load} />');
    const chip = (await import('./LoadChip.tsx?raw')).default;
    const face = chip.slice(chip.indexOf('function Face'), chip.indexOf('export function LoadChip'));
    expect(face).not.toMatch(/load1|toFixed/);
    expect(face).toContain('<IconGauge lv={lv} />'); // 1안: 게이지 + 원인은 탈 났을 때만(bad)
    expect(face).toMatch(/bad\.map/);
    expect(bar).not.toMatch(/맥이 바빠요/);
  });
  it("사용 한도 앞에 'Claude 한도', 참모가 하나도 없으면(첫 날) 한도·커밋 숫자를 숨긴다", async () => {
    const bar = (await import('./TopBar.tsx?raw')).default;
    expect(bar).toContain("tr('Claude 한도', 'Claude limit')");
    expect(bar).toMatch(/\{!fresh && <>/);
    expect(app).toMatch(/fresh=\{navOrchs\.length \+ offOrchList\.length === 0\}/);
  });
});

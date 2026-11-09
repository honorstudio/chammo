import { describe, expect, it } from 'vitest';
import app from '../App.tsx?raw';
import gate from './LoginGate.tsx?raw';
import devices from './DevicesSection.tsx?raw';
import setup from './Setup.tsx?raw';
import firstRun from './FirstRun.tsx?raw';
import login from './useLogin.ts?raw';
import notifyMac from '../../src-tauri/src/notify_mac.rs?raw';

// 2026-11-01 ux-start QA — 첫 설정 뒤 로그인 문·둘러보기·첫 기기 질문
describe('첫 설정 뒤 화면 순서(H1)', () => {
  it('App 은 로그인 문 상태를 받아 둘러보기를 그 뒤에 그린다', () => {
    expect(app).toMatch(/<LoginGate onGate=\{setLoginGate\} \/>/);
    expect(app).toMatch(/tourVisible\(tourOpen && !consentAsk, loginGate\) && <Tour /);
  });
  it('LoginGate 는 상태를 못 읽었을 땐 null, 읽은 뒤엔 문 상태를 알린다', () => {
    expect(gate).toMatch(/onGate\?\.\(v \? gate : null\)/);
  });
  it('점검의 Claude 로그인 줄은 범위를 좁힌 글', () => {
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
    expect(firstRun).toMatch(/assistantName: firstRunName\(draft\.assistantName, draft\.language\)/);
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

describe('첫 설치 창(ADR 0027)', () => {
  it('첫 실행이면 App 은 FirstRun 만 그린다, 설정 파일이 있는 사람은 setupDone 이라 안 뜬다', () => {
    expect(app).toMatch(/if \(firstRun && config\) return <FirstRun config=\{config\} \/>/);
  });
  it('터미널 믿기가 없다 — 시작 = 동의, 준비가 앱이 직접 적는다', () => {
    expect(firstRun).toContain('trustConsent(draft.devRoot)');
    expect(firstRun).toContain('trustFolders(draft.devRoot, draft.hqDir)');
    expect(setup).not.toMatch(/key=\{`trust-/);
  });
  it('브라우저는 시험 열기까지 통과해야 끝 — 넘기기 없음', () => {
    expect(firstRun).toMatch(/r\.done && !r\.running\)[\s\S]{0,240}st\.ready\) return 'ok'/);
    expect(setup).not.toContain('브라우저 자동화 (선택)');
  });
  it('계정 추가는 설정 > 계정과 같은 길, 안 누르면 저절로 넘어간다', () => {
    expect(firstRun).toContain('accountsApi.capture()');
    expect(firstRun).toMatch(/addState\(v, more\.start\)/);
    expect(firstRun).toContain('AUTO_NEXT_MS');
  });
  it('알림은 마지막에 맥이 한 번 — 기다리지 않는다', () => {
    expect(firstRun).toMatch(/void notifyRequest\(\)/);
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

// 0.4.9 릴리스 점검 — 첫 설치 압축(ADR 0027)에서 0.4.8 마법사의 통계 안내 줄이 빠졌다. README '새로 깐 사람은 첫 설정에서 이 안내를 본 뒤에야 보냅니다'
describe('첫 설치 마지막 화면의 익명 사용 통계 안내', () => {
  it('통계가 켜져 있으면 시작하기 전에 안내 줄을 보여 준다', () => {
    expect(firstRun).toMatch(/draft\.features\.usagePing && <p className="fr-note">/);
    expect(firstRun).toContain('하루 한 번 익명 사용 통계를 보내요');
  });
});

// 0.4.9 아이맥 첫 설치 실측 — 깨끗한 맥에서 켠 지 2초 만에 '로그인이 풀렸어요'를 부르고(F1), 시작 화면에서 알림 권한을 물었다(F2, ADR 0027 7항 '시작하기 뒤')
describe('첫 설치 중엔 알림을 안 부른다', () => {
  it("로그인 필요 알림은 첫 설치를 마친 뒤부터", () => {
    expect(login).toMatch(/useLogin\(acts: SessionActivity\[\], accounts: AccountsView \| null, voice: boolean, ready: boolean\)/);
    expect(login).toMatch(/plan\.need && shownSince\.current === null && readyRef\.current/);
    expect(app).toMatch(/useLogin\(\[\.\.\.allActs, \.\.\.sideActs, \.\.\.routineActs\], accounts, voice && features\.voice, config\?\.setupDone === true\)/);
  });
  it('맥 알림 권한은 첫 설치를 마친 뒤부터 — 켤 때 묻는 건 setup_done 일 때만, 첫 설치는 시작하기에서 notifyRequest', () => {
    expect(notifyMac).toMatch(/if crate::config::read_config\(\)\.setup_done \{\s*request_auth\(\);/);
    expect(firstRun).toContain('void notifyRequest()');
  });
});

describe('첫 설치 뒤 첫 참모', () => {
  it('시작하기가 표시를 남기고 App 이 한 번만 띄운다 — 동의 카드 동안 둘러보기는 기다린다', () => {
    expect(firstRun).toMatch(/localStorage\.setItem\(FIRST_SPAWN_KEY, '1'\)/);
    expect(app).toMatch(/firstSpawnDue\(\{/);
    expect(app).toMatch(/localStorage\.removeItem\(FIRST_SPAWN_KEY\);\s*void spawnOrchestrator\(\)/);
    expect(app).toMatch(/tourVisible\(tourOpen && !consentAsk, loginGate\)/);
  });
});

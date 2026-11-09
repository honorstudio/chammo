// 팀 권한 화면 연결(chammo-relay ADR 0015, 시안 team-lock v1 — PC C 레일 팀 칸·소개 판, 폰 A 시트) — DOM 없이 소스로 지킨다
import { describe, expect, it } from 'vitest';
import rail from './TeamRail.tsx?raw';
import mode from './useTeamMode.tsx?raw';
import start from './TeamStart.tsx?raw';
import lock from './TeamLock.tsx?raw';
import phone from '../mobile/PhoneTeamAdd.tsx?raw';
import api from '../../data/teamApi.ts?raw';

describe('새 팀 만들기 자리 — 권한 없으면 문의 창', () => {
  it('만들기 칸보다 먼저 createLock(서버 plan)·만들기 402 꼬리표(planErr)를 본다', () => {
    expect(start).toMatch(/const lock = screen === 'make' && !made \? \(lockErr \?\? createLock\(view\?\.plan\)\) : null;\s*if \(lock\) return <LockBox/);
    expect(start.indexOf('if (lock) return <LockBox')).toBeLessThan(start.indexOf("if (screen === 'make') {"));
    expect(start).toContain('const l = planErr(String(e));');
  });
  it('문의창: 문의하기(바깥 열기) + 초대 링크로 들어가기 — 기한 끝이면 들어가기는 뺀다', () => {
    expect(lock).toContain("openTarget('url', url)");
    expect(lock).toContain("lock.kind !== 'expired'");
  });
});

describe('레일 — 팀이 없고 권한이 없거나 로그인 전이면 + 대신 팀 칸', () => {
  it('팀 칸은 사람 그림 아이콘 하나(이름은 aria-label·툴팁) — 아이콘+글자 줄 금지', () => {
    expect(rail).toMatch(/onIntro && !stack\.length\s*\? <IconButton size="l" className="rail-new tmx-rail-add tml-rail-team" label=\{tr\('팀', 'Team'\)\}/);
    expect(rail).toContain('<IconPeople />');
    expect(mode).toContain("onIntro={showIntro(view) ? () => { data.refresh(); setPop({ kind: 'intro' }); } : undefined}");
  });
  it('화면 상태가 늦어(밖에서 로그인·권한 받음) 팀 칸이 남아 있어도 — 누르면 다시 읽고, 소개 판 조건이 아니면 만들기 창', () => {
    expect(mode).toContain("{pop.kind === 'intro' && showIntro(view)");
    expect(mode).toContain("pop.kind === 'intro' ? 'make' : undefined");
  });
  it('소개 판엔 로그인 길이 없다 — 로그인 문이 먼저라 안 닿고, 운영 기본 주소로 가는 길을 하나 덜 둔다', () => {
    expect(mode).toContain("<TeamIntro contact={contactOf(view?.plan)}");
    expect(mode).not.toContain('teamLogin');
    expect(lock).not.toContain('teamLogin');
  });
});

describe('읽기만 되는 팀', () => {
  it('대화 목록 위 한 줄(팀장은 문의하기)', () => {
    expect(mode).toContain('{closedLine(view) && <ClosedLine owner={closedLine(view)!.owner} contact={contactOf(view.plan)} />}');
  });
});

describe('폰 — + 시트의 새 팀 만들기가 같은 시트에서 문의 칸', () => {
  it('createLock·planErr 를 보고 문의하기는 링크(메일·https), 들어가기는 그대로', () => {
    expect(phone).toContain('const lock = step === \'make\' && !made ? (lockErr ?? createLock(view?.plan)) : null;');
    expect(phone).toContain('href={contactOf(view?.plan)}');
    expect(phone).toContain("{step === 'make' && !made && !lock && <>");
  });
});

describe('화면 상태 모양', () => {
  it('TeamView 에 plan·팀마다 closed', () => {
    expect(api).toContain('plan?: TeamPlan | null;');
    expect(api).toContain('closed?: boolean');
  });
});

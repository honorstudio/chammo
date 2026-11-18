import { describe, expect, it } from 'vitest';
import rail from './OrchRail.tsx?raw';
import space from './SpaceView.tsx?raw';
import lockerCss from './locker.css?raw';
import avatarCss from '../avatar/avatar.css?raw';
import { avatarClasses } from '../../domain/avatar';

// 켤 때 점호 v3(2026-11-17 사용자 "다 좋다") — 재부팅으로 꺼진 참모는 쉬는 칸이 아니라 위 띠 제자리, 재워 둔 참모는 지금처럼 쉬는 칸
describe('띠 — 깨울 차례 칸', () => {
  it('SpaceView 가 lost 를 먼저 갈라(splitOff) 위 띠 줄에 넣고, 쉬는 칸엔 나머지만', () => {
    expect(space).toMatch(/const split = splitOff\(\{ stopped: stoppedOrchs\(stopped, orchCwd, orchs\), lost: lostOrchs/);
    expect(space).toMatch(/lost: split\.lostTop\.map\(lostAsStopped\)/);
    expect(space).toMatch(/resting=\{split\.resting\.map/);
    expect(space).not.toMatch(/resting=\{stoppedOrchs\(/);
  });
  it('깨울 차례 칸 — 감은 눈 프사(queued, 실패면 failed)·점선 고리 점, 누르면 차례를 앞당겨 깨운다', () => {
    expect(space).toMatch(/phase: 'lost'[^}]*pip: r\.failed \? 'fail' : 'queue'/);
    expect(space).toMatch(/phase=\{r\.failed \? 'failed' : 'queued'\}/);
    expect(rail).toMatch(/if \(a\.phase === 'lost'\) a\.onWake\?\.\(\); else if \(!a\.phase\) onPick\(a\.id\);/);
    // 점은 깨울 차례에도 보인다(켜는 중·끄는 중 단계 점과 따로)
    expect(rail).toMatch(/a\.pip && \(!a\.phase \|\| a\.phase === 'lost'\) && <i className=\{`lk-pip p-\$\{a\.pip\}`\}/);
    expect(lockerCss).toMatch(/\.lk-pip\.p-queue \{[^}]*dashed/);
    expect(lockerCss).toMatch(/\.lk-pip\.p-fail \{[^}]*var\(--danger-ink\)/);
  });
  it('프사 단계 queued·failed — 꺼짐처럼 감은 눈이지만 queued 는 바로 서서 숨쉬고, failed 는 기운다', () => {
    expect(avatarClasses({ image: false, state: 'off', transition: null, size: 32, phase: 'queued' })).toContain('oa-ph-queued');
    expect(avatarCss).toMatch(/\.oa\.oa-ph-queued \.oa-tr \{ transform: none; \}/);
    expect(avatarCss).toMatch(/\.oa-ph-queued \.oa-all \{[^}]*oa-breathe/);
    expect(avatarCss).toMatch(/\.oa\.oa-ph-failed \.oa-tr \{[^}]*rotate\(-10deg\)/);
  });
});

describe('띠 — 쉬는 칸에서 고른 참모는 제자리로 올라간다', () => {
  it('접힌 띠 쉬는 칸이 자리 옮김 출발점(__rest)이고, 처음 보는 칸이 쉬는 칸에 있던 참모면 거기서 올라온다', () => {
    expect(rail).toMatch(/className=\{`lk-av rest-fold[^`]*`\} data-flip="__rest"/);
    expect(rail).toMatch(/const rest = !was && riseFrom\(prevSig, el\.dataset\.flip!\) === 'rest' \? prev\.get\('__rest'\) : undefined;/);
  });
});

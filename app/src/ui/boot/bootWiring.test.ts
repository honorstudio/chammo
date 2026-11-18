import { describe, expect, it } from 'vitest';
import roll from './BootRollcall.tsx?raw';
import css from './boot.css?raw';
import app from '../../App.tsx?raw';
import main from '../../main.tsx?raw';
import chat from '../chat/ChatView.tsx?raw';
import html from '../../../index.html?raw';

// 켤 때 점호(시안 v3, 2026-11-17 사용자 "다 좋다") — 덮개가 앱 사실을 받아 다 되면(또는 3초) 띠 제자리로 날아가 걷힌다
describe('점호 덮개 연결', () => {
  it('App 이 띠와 같은 줄(순서·고정·깨울 차례)과 쉬는 칸으로 사실을 만들어 넘긴다 — 채팅 보기·첫 설치 아님일 때만', () => {
    expect(app).toMatch(/const sp = splitOff\(\{ stopped: stoppedOrchs\(resumable\(stopped, sessions\), cwd, navOrchs\), lost: lostOrchs/);
    expect(app).toMatch(/railRows\(\{ live: navOrchs, stopping: new Set\(\), starting: startingOrchs, lost: sp\.lostTop\.map\(lostAsStopped\), failed: wakeFailed/);
    // 꺼진 목록(가장 늦게 온다)은 안 기다린다 — lost 는 재시작 기록으로 안다
    expect(app).toMatch(/meta: metaSeen === 7, all: snapReady, restKnown: stoppedReady, noChat: navOrchs\.length === 0/);
    // 꺼진 목록 전엔 지난번 쉬는 묶음에서 지금 위 띠 참모를 뺀다(restGuess) — 걷힌 뒤 꺼진 목록이 오면 기억을 고쳐 남기고 그때 끝(상한 있음)
    // 참모 목록·재시작 기록이 둘 다 와야 사실로 그린다 — 하나만 오면 lost 참모가 줄에서 빠졌다 돌아온다
    expect(roll).toMatch(/const known = facts\.sessions && facts\.all;/);
    expect(roll).toMatch(/const rest: BootRow\[\] = !known \? mem\.rest : facts\.restKnown \? facts\.rest : restGuess\(\[\.\.\.mem\.top, \.\.\.mem\.rest\], top\)\.map\(\(c\) => \(\{ \.\.\.c, face: 'resting' as const \}\)\);/);
    expect(roll).toMatch(/if \(phase !== 'gone'\) return;\n    if \(facts\.restKnown\) \{ if \(flew\.current\) fixRest\(flew\.current, \[\.\.\.facts\.top, \.\.\.facts\.rest\], facts\.rest\.length, saved\); onDone\?\.\(\); return; \}/);
    expect(roll).toMatch(/window\.setTimeout\(\(\) => onDone\?\.\(\), REST_WAIT_MS\)/);
    expect(app).toMatch(/\{bootFacts && <BootRollcall enabled=\{space && !firstRun\} facts=\{bootFacts\} onDone=\{\(\) => setBootDone\(true\)\} \/>\}/);
    expect(app).toMatch(/if \(bootDone\) return null;/); // 걷힌 뒤엔 계산도 안 한다
    // 재시작 정리(triageLost)가 참모를 기록에서 빼도 깰 때까지 위 띠 깨울 차례에(아이맥 실측 11-17 — 쉬는 칸으로 내려갔다)
    expect(app).toMatch(/const lostOrchs = useMemo\(\(\) => \(lostSeen\.current = keepLost\(lostSeen\.current, lost\.filter\(isLostOrch\), navOrchs\)\)/);
  });
  it('기다림은 bootGate 한 곳 — 데이터 넷·대화 첫 쪽(ChatView 신호)·3초 상한', () => {
    expect(roll).toMatch(/const gate = bootGate\(\{ elapsed: performance\.now\(\), data: \{ sessions: facts\.sessions, roles: facts\.meta, avatars: avatarsKnown, all: facts\.all, chat \}/);
    expect(roll).toMatch(/Math\.max\(0, BOOT_CAP_MS - performance\.now\(\)\)/);
    expect(chat).toMatch(/bootSignal\('chat'\)/);
  });
  it('참모 목록 전엔 지난번 기억(memoRows)으로 줄을 그린다 — 처음부터 자리가 다 있다', () => {
    expect(roll).toMatch(/const top: BootRow\[\] = known \? facts\.top : mem\.top;/);
  });
  it('날기 — 띠 프사 칸(data-flip)·쉬는 칸으로, 날아가는 동안 띠의 진짜 프사·점은 숨긴다. 동작 줄이기면 흐려지기만', () => {
    expect(roll).toMatch(/\.lk-strip \[data-flip="\$\{CSS\.escape\(key\)\}"\] \.lk-av-pic/);
    expect(roll).toMatch(/\.lk-strip \.rest-fold \.rest-faces/);
    expect(css).toMatch(/html\.boot-fly \.lk-strip \.lk-av-pic > \.oa, html\.boot-fly \.lk-strip \.lk-pip/);
    expect(roll).toMatch(/const moving = motionOn\(\);/);
    expect(roll).toMatch(/el\.style\.pointerEvents = 'none';/);
  });
});

describe('첫 장면 — index.html 이 앱 묶음 전에 지난번 줄을 그린다', () => {
  it('지난번 줄(BOOT_HTML_KEY)·바탕을 #boot 에, 점호 덮개가 이어받아 지우고 main 이 4초 뒤 한 번 더 지운다(오류 화면을 안 가리게)', () => {
    expect(html).toMatch(/<div id="boot" aria-hidden="true"><\/div>/);
    expect(html).toMatch(/localStorage\.getItem\('chammo\.boot\.html\.v1'\)/);
    expect(roll).toMatch(/BOOT_HTML_KEY = 'chammo\.boot\.html\.v1'/);
    expect(roll).toMatch(/useLayoutEffect\(\(\) => \{ document\.getElementById\('boot'\)\?\.remove\(\); \}, \[\]\);/);
    expect(main).toMatch(/window\.setTimeout\(\(\) => document\.getElementById\('boot'\)\?\.remove\(\), 4000\)/);
  });
  it('바탕색은 rgb·#색 꼴만 받는다(그대로 style 에 들어간다)', () => {
    expect(html).toMatch(/\/\^rgba\?\\\(\[\\d\.,\\s%\]\+\\\)\$\|\^#\[0-9a-f\]\{3,8\}\$\/i\.test\(bg\)/);
  });
  it('프사 기억(keep) — 데스크톱도 다시 켤 때 저장한 모양·색으로 바로', () => {
    expect(main).toMatch(/setAvatarSource\(\{ keep: \{/);
  });
});

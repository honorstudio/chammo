import { describe, expect, it } from 'vitest';
import { ctxFromAgents, foldSummary, heldIds, orchAsk, orchTasks, releaseSnap, routineOrch, rubberTop, sheetTop, closeOnRelease, dropLabel, keyboardOpen, frameAt, driftBias, ghostKeyboard, readViewport, diagLine, isTyping, liveWork, phoneBubble, usageText, waitingList, withAttachments, phoneName, offOrchRows, wokeOrch, waitAnswer, waitKey, shownWaiting, pruneWaitSent, dupAnswer, answerFail, sessionBoard, nearBottom, stickBottom, shrinkPlan, withEarlier, wantEarlier, nextAfterStop, lineSlot, orchMenu, pendingName, prunePendingNicks } from './mobile';
import type { Session } from './session';
import type { ChatItem } from './chat';
import type { TaskEvent } from './tasks';

const o = (id: string, name: string) => ({ id, name });

describe('예약 담당 참모', () => {
  it('이름에 루틴이 든 참모가 먼저', () => {
    expect(routineOrch([o('a', '참모-2 · 참모 업데이트'), o('b', '참모-4 · 루틴담당')], 'a')).toBe('b');
  });
  it('없으면 마지막으로 쓴 참모, 그것도 없으면 맨 앞', () => {
    expect(routineOrch([o('a', '참모-2'), o('b', '참모-3')], 'b')).toBe('b');
    expect(routineOrch([o('a', '참모-2'), o('b', '참모-3')], 'gone')).toBe('a');
    expect(routineOrch([], null)).toBeUndefined();
  });
});

describe('세션 목록의 컨텍스트', () => {
  it('ctx 칸을 sessionId 별로 — domain/ctx 파서 그대로', () => {
    const json = JSON.stringify([{ id: 'a', sessionId: 's1', ctx: { sessionId: 's1', used: 73, ts: 5 } }, { id: 'b', sessionId: 's2' }]);
    expect(ctxFromAgents(json)).toEqual({ s1: { used: 73, ts: 5 } });
    expect(ctxFromAgents('nope')).toEqual({});
  });
});

describe('그림 붙여 보내기', () => {
  it('데스크톱 끌어 놓기와 같은 모양 — 경로(띄어쓰기는 이스케이프) 뒤에 글', () => {
    expect(withAttachments('이거 봐', ['/d/attach/1-phone.png'])).toBe('/d/attach/1-phone.png 이거 봐');
    expect(withAttachments('글만', [])).toBe('글만');
    expect(withAttachments('', ['/a b.png'])).toBe('/a\\ b.png');
  });
});

describe('채팅 시트 세 높이', () => {
  const H = 800;
  it('살짝 = 아래 128px, 반 = 화면 65%, 전체 = 위 24px 남김', () => {
    expect(sheetTop('peek', H)).toBe(672);
    expect(sheetTop('half', H)).toBe(280);
    expect(sheetTop('full', H)).toBe(24);
  });
  it('살짝은 잰 높이(손잡이+한 줄+입력줄)를 받는다 — 그림 칩·여러 줄이 생겨도 입력줄이 화면 밖으로 안 밀린다', () => {
    expect(sheetTop('peek', H, 200)).toBe(600);
    // 끝 고무줄·놓을 곳도 같은 높이로
    expect(rubberTop(700, H, 200)).toBe(600 + 100 * 0.35);
    expect(releaseSnap('half', 280, 590, 0.05, H, 200)).toBe('peek');
    // 반보다 커지진 않는다(살짝이 반을 넘으면 순서가 뒤집힌다)
    expect(sheetTop('peek', H, 700)).toBe(sheetTop('half', H) + 1);
  });
});

const ses = (id: string, name: string, state: Session['state']): Session =>
  ({ id, name, cwd: '/d/' + name, kind: 'background', state, project: name, workspace: null, startedAt: 0 } as Session);

describe('그 참모가 시킨 일 — 접는 한 줄과 펼친 묶음', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const ev: TaskEvent[] = [
    { ts: '2026-10-02T10:00:00Z', type: 'send', task: 't1', target: 'shop', from: 'o1', title: '버그 고치기' },
    { ts: '2026-10-02T10:01:00Z', type: 'send', task: 't2', target: 'blog', from: 'o1', title: '글 쓰기' },
    { ts: '2026-10-02T10:02:00Z', type: 'send', task: 't3', target: 'docs', from: 'o1', title: '문서' },
    { ts: '2026-10-02T11:00:00Z', type: 'done', task: 't3' },
    { ts: '2026-10-02T10:03:00Z', type: 'send', task: 't4', target: 'other', from: 'o2', title: '남의 일' },
  ];
  const sessions = [ses('s1', 'shop', 'working'), ses('s2', 'blog', 'blocked'), ses('s3', 'docs', 'idle'), ses('s4', 'other', 'working')];
  it('물어봄 → 일하는 중 → 끝남, 다른 참모 일은 뺀다', () => {
    const g = orchTasks(ev, sessions, 'o1', now);
    expect(g.ask.map((c) => c.title)).toEqual(['글 쓰기']);
    expect(g.doing.map((c) => c.title)).toEqual(['버그 고치기']);
    expect(g.done.map((c) => c.title)).toEqual(['문서']);
    expect(foldSummary(g)).toBe('시킨 일 3 · 물음 1 · 일함 1');
  });
  it('맡긴 세션 id — 그 참모가 마지막으로 일을 보낸 세션', () => {
    expect(heldIds(ev, sessions, 'o1', now).sort()).toEqual(['s1', 's2', 's3']);
    expect(heldIds(ev, sessions, 'o2', now)).toEqual(['s4']);
  });
});

describe('사용량 칩 글', () => {
  it('5시간·주간 남은 %, 값이 없으면 빈 글', () => {
    const now = 1_000_000_000_000;
    const j = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 38, resets_at: now / 1000 + 3600 }, seven_day: { used_percentage: 60 } } });
    expect(usageText(j, now)).toBe('5시간 62% · 주 40%');
    expect(usageText('{}', now)).toBe('');
  });
});

describe('참모 물음 — 사용자 답을 기다리는 것', () => {
  const user = (text: string, ts: string) => ({ kind: 'user' as const, id: ts, ts, text });
  const ai = (text: string, ts: string) => ({ kind: 'assistant' as const, id: ts, ts, text });
  it('마지막이 묻는 답이고 쉬는 중이면 물음(결론·질문), 내가 답했거나 일하는 중이면 아님', () => {
    expect(orchAsk([user('해줘', '1'), ai('빌드 끝났어. 배포할까?', '2')], 'idle')).toEqual({ ts: '2', lead: '빌드 끝났어.', q: '배포할까?' });
    expect(orchAsk([ai('배포할까?', '2'), user('응', '3')], 'idle')).toBeNull();
    expect(orchAsk([ai('배포할까?', '2')], 'working')).toBeNull();
    expect(orchAsk([ai('끝났어.', '2')], 'idle')).toBeNull();
  });
  it('물음 목록 — 답 끝 질문 · 멈춘 창 · scripts/task ask, 최근 위, 참모 수', () => {
    const o1 = ses('o1', '참모-1', 'idle');
    o1.sessionId = 'u1';
    const o2 = ses('o2', '참모-2 · 디자인', 'blocked');
    const o3 = ses('o3', '참모-3', 'idle');
    o3.sessionId = 'u3';
    const ev: TaskEvent[] = [
      { ts: '2026-10-02T09:00:00Z', type: 'send', task: 'k', target: 'shop', from: 'o3', title: '결제 붙이기' },
      { ts: '2026-10-02T09:30:00Z', type: 'ask', task: 'k', note: '실결제 테스트 해도 돼?', to: 'u3' },
    ];
    const w = waitingList([o1, o2, o3], { o1: { ts: '2026-10-02T10:00:00Z', lead: '', q: '배포할까?' } }, ev);
    expect(w.map((x) => [x.orch, x.kind])).toEqual([['o1', 'ask'], ['o3', 'decide'], ['o2', 'blocked']]);
    expect(w.find((x) => x.kind === 'decide')!.q).toBe('실결제 테스트 해도 돼?');
    expect(w.find((x) => x.kind === 'decide')!.taskId).toBe('k');
    expect(new Set(w.map((x) => x.orch)).size).toBe(3);
  });
});

describe('시트 끌기 감도 — 놓을 때 어디로 붙나', () => {
  const H = 800; // 살짝 672 · 반 280 · 전체 24
  it('짧은 플릭(빠르게 툭)은 거리와 상관없이 그 방향 다음 높이', () => {
    expect(releaseSnap('peek', 672, 657, -0.6, H)).toBe('half');
    expect(releaseSnap('full', 24, 34, 0.5, H)).toBe('half');
    expect(releaseSnap('half', 280, 270, -0.4, H)).toBe('full');
    expect(releaseSnap('half', 280, 290, 0.45, H)).toBe('peek');
  });
  it('느린 끌기는 다음 높이까지 거리의 25% 나 40px 중 작은 쪽을 넘으면 넘어간다', () => {
    expect(releaseSnap('peek', 672, 642, -0.05, H)).toBe('peek'); // 30px — 문턱 40 아래
    expect(releaseSnap('peek', 672, 630, -0.05, H)).toBe('half'); // 42px
    expect(releaseSnap('full', 24, 60, 0.05, H)).toBe('full'); // 36px — 반까지 256 의 25%=64 와 40 중 작은 쪽 40 → 못 넘음
    expect(releaseSnap('full', 24, 66, 0.05, H)).toBe('half');
  });
  it('느리게 길게 끌면 놓은 곳에서 가장 가까운 높이(두 칸도)', () => {
    expect(releaseSnap('peek', 672, 40, -0.05, H)).toBe('full');
    expect(releaseSnap('full', 24, 650, 0.08, H)).toBe('peek');
  });
  it('반대 방향으로 되돌리면 — 마지막 손짓을 따른다', () => {
    // 위로 끌다가 거의 제자리로 돌아와 놓음 → 그대로
    expect(releaseSnap('peek', 672, 668, 0.1, H)).toBe('peek');
    // 반에서 위로 100 끌었다가 아래로 툭 → 아래 높이로
    expect(releaseSnap('half', 280, 180, 0.5, H)).toBe('peek');
  });
  it('끝(살짝 아래·전체 위)을 넘으면 약한 고무줄', () => {
    expect(rubberTop(672 + 100, H)).toBe(672 + 35);
    expect(rubberTop(24 - 100, H)).toBe(24 - 35);
    expect(rubberTop(400, H)).toBe(400);
  });
});

describe('phoneBubble — 폰이 보낸 말의 첨부 경로를 @img·@file 이름표로', () => {
  const A = '/Users/me/.honor-orchestrator/attach/1790949356271-phone.jpg';
  const B = '/Users/me/.honor-orchestrator/attach/1790949356272-phone.pdf';
  it('사용자 실기기 줄 — 경로는 빼고 썸네일로', () => {
    expect(phoneBubble(`${A} 닫힌 상태로 이미지 올릴경우 ui밀림 발생.`)).toEqual({
      body: '닫힌 상태로 이미지 올릴경우 ui밀림 발생.',
      atts: [{ path: A, label: '@img1', image: true }],
    });
  });
  it('그림·파일은 따로 센다, 보낸 모양(withAttachments) 그대로 되돌린다', () => {
    const C = A.replace('271-', '273-').replace('.jpg', '.png');
    expect(phoneBubble(withAttachments('@img1 @img2 비교 @file1', [A, B, C]))).toEqual({
      body: '@img1 @img2 비교 @file1',
      atts: [{ path: A, label: '@img1', image: true }, { path: B, label: '@file1', image: false }, { path: C, label: '@img2', image: true }],
    });
  });
  it('첨부 폴더 이름 꼴이 아닌 경로는 글 그대로', () => {
    const t = '/Users/me/Desktop/a.png 이거 봐';
    expect(phoneBubble(t)).toEqual({ body: t, atts: [] });
    expect(phoneBubble('/Users/me/x/attach/1-image.png 봐').atts).toEqual([]);
  });
  it('그림만 보내면 글은 빈 것', () => {
    expect(phoneBubble(A)).toEqual({ body: '', atts: [{ path: A, label: '@img1', image: true }] });
  });
});

describe('dropLabel — 칩을 빼면 입력칸의 이름표도', () => {
  it('그 이름표와 뒤 공백 하나만, @img10 은 그대로', () => {
    expect(dropLabel('@img1 @img10 이거', '@img1')).toBe('@img10 이거');
    expect(dropLabel('봐 @img2', '@img2')).toBe('봐 ');
    expect(dropLabel('없음', '@img3')).toBe('없음');
  });
});

describe('keyboardOpen — 보이는 높이로 키보드 판정', () => {
  it('같은 폭에서 본 가장 큰 높이보다 150px 넘게 작으면 키보드', () => {
    let t = { w: 0, h: 0 };
    let r = keyboardOpen(t, 390, 750); t = r.tallest;
    expect(r.kb).toBe(false);
    r = keyboardOpen(t, 390, 440); t = r.tallest;
    expect(r.kb).toBe(true);
    r = keyboardOpen(t, 390, 700); // 주소 막대만 줄었다 늘었다
    expect(r.kb).toBe(false);
  });
  it('돌리면(폭이 바뀌면) 기준을 새로 — 가로 화면 낮은 높이를 키보드로 안 본다', () => {
    const t = keyboardOpen({ w: 0, h: 0 }, 390, 750).tallest;
    expect(keyboardOpen(t, 844, 360).kb).toBe(false);
  });
  it('키보드를 연 채 돌리면 새 기준이 키보드 높이라 못 알아본다 — 레이아웃 높이(innerHeight)보다 150px 넘게 작으면 키보드(2026-10-04 시뮬레이터 가로 118/390)', () => {
    const t = keyboardOpen({ w: 0, h: 0 }, 390, 797).tallest;
    expect(keyboardOpen(t, 844, 118, 390).kb).toBe(true);
    expect(keyboardOpen(t, 844, 360, 390).kb).toBe(false);
  });
});

describe('frameAt — 화면 틀(.m-app) 자리: 글 쓰는 중만 보이는 화면을 따라가고 아니면 맨 위', () => {
  it('키보드가 닫혔는데 offsetTop 이 61 로 남으면(2026-10-04 실기기 — 위가 비고 입력칸이 잘림) 맨 위 0 + 문서 되돌리기', () => {
    expect(frameAt({ vvTop: 61, vvH: 797, layoutH: 797, scrollY: 0, kb: false, editing: false })).toEqual({ top: 0, h: 797, scroll: true });
  });
  it('문서만 밀려 있어도(scrollY) 되돌린다', () => {
    expect(frameAt({ vvTop: 0, vvH: 797, layoutH: 797, scrollY: 61, kb: false, editing: false })).toEqual({ top: 0, h: 797, scroll: true });
  });
  it('밀린 게 없으면 건드리지 않는다', () => {
    expect(frameAt({ vvTop: 0, vvH: 797, layoutH: 797, scrollY: 0, kb: false, editing: false })).toEqual({ top: 0, h: 797, scroll: false });
  });
  it('입력칸에 쓰는 중이면 iOS 가 올린 만큼 따라간다(키보드 위 입력줄) — 되돌리지 않는다', () => {
    expect(frameAt({ vvTop: 403, vvH: 394, layoutH: 797, scrollY: 403, kb: true, editing: true })).toEqual({ top: 403, h: 394, scroll: false });
  });
  it('돌린 직후처럼 키보드 판정이 틀려도 쓰는 중이면 따라간다', () => {
    expect(frameAt({ vvTop: 120, vvH: 394, layoutH: 797, scrollY: 120, kb: false, editing: true })).toEqual({ top: 120, h: 394, scroll: false });
  });
  it('키보드를 닫았는데 보이는 높이가 793 으로 남으면(돌린 뒤 iOS, 2026-10-04 시뮬레이터) 레이아웃 높이 797 — 바닥이 4px 비지 않게', () => {
    expect(frameAt({ vvTop: 0, vvH: 793, layoutH: 797, scrollY: 0, kb: false, editing: false })).toEqual({ top: 0, h: 797, scroll: false });
  });
  it('키보드로 보이는데 포커스가 없으면(닫히는 중) 따라간다 — 다음 사건에서 맨 위로', () => {
    expect(frameAt({ vvTop: 403, vvH: 394, layoutH: 797, scrollY: 403, kb: true, editing: false })).toEqual({ top: 403, h: 394, scroll: false });
  });
});

describe('ghostKeyboard — 키보드가 닫혔는데 iOS 가 보이는 높이를 안 돌려준 상태(2026-10-08 사용자 실기기 홈 화면 앱)', () => {
  it('글 쓰는 칸에 포커스 없이 0.7초 넘게 키보드 높이면 유령 — 키보드는 포커스가 있어야만 뜬다', () => {
    expect(ghostKeyboard({ kb: true, typing: false, quietMs: 700, touch: true })).toBe(true);
    expect(ghostKeyboard({ kb: true, typing: false, quietMs: 30000, touch: true })).toBe(true);
  });
  it('포커스가 빠진 직후(키보드가 내려가는 중)는 기다린다 — 입력줄이 내려가는 키보드 뒤로 먼저 숨지 않게', () => {
    expect(ghostKeyboard({ kb: true, typing: false, quietMs: 300, touch: true })).toBe(false);
  });
  it('쓰는 중이면 진짜 키보드', () => {
    expect(ghostKeyboard({ kb: true, typing: true, quietMs: 5000, touch: true })).toBe(false);
  });
  it('키보드 높이가 아니면 고칠 것 없음', () => {
    expect(ghostKeyboard({ kb: false, typing: false, quietMs: 5000, touch: true })).toBe(false);
  });
  it('터치 없는 화면(데스크톱 창을 줄인 것)은 손대지 않는다 — 거기선 작은 높이가 진짜', () => {
    expect(ghostKeyboard({ kb: true, typing: false, quietMs: 5000, touch: false })).toBe(false);
  });
});

describe('readViewport — visualViewport 가 엉터리 높이를 줄 때(2026-10-09 사용자 실기기 홈 화면 앱, iOS 26)', () => {
  // 402×874 폰, 홈 화면 앱 웹 화면 812. 실기기 진단: 쉴 때 vvH = innerHeight - 874(-62), 키보드를 열면 innerHeight 는 키보드만큼 줄었는데 vvH 는 거기서 또 빠진 작은 값
  const full = { w: 402, h: 812 };
  const base = { vvW: 402, innerW: 402, layoutH: 812, tallest: full, touch: true };
  it('키보드가 떠 있고 innerHeight 가 이미 키보드를 따라갔으면 그쪽을 믿는다 — 화면 틀이 145px 로 줄어 입력칸이 손잡이 밑에 붙고 아래가 비었다', () => {
    const r = readViewport({ ...base, vvH: 149, vvTop: 403, innerH: 409, scrollY: 403, editing: true, quietMs: 0 });
    expect(r).toMatchObject({ h: 409, top: 403, kb: true });
  });
  it('쉴 때 vvH 가 0 이하면 innerHeight — 키보드를 닫은 직후(유령 판정 0.7초 전)에도 음수 높이로 그리지 않는다', () => {
    const r = readViewport({ ...base, vvH: -62, vvTop: 0, innerH: 812, scrollY: 0, editing: false, quietMs: 0 });
    expect(r).toMatchObject({ h: 812, kb: false, ghost: false });
  });
  it('vvW 가 0(앱이 가려진 채 읽힘)이어도 같은 폭 기준(tallest)을 버리지 않는다', () => {
    const r = readViewport({ ...base, vvH: 0, vvW: 0, vvTop: 0, innerH: 812, scrollY: 0, editing: false, quietMs: 0 });
    expect(r.tallest).toEqual(full);
  });
  it('vvH 가 innerHeight 보다 크면(어느 브라우저에서도 안 되는 값) innerHeight — 키보드를 열었는데 vvH 가 812 로 남아 입력줄이 키보드 뒤로 숨지 않게', () => {
    expect(readViewport({ ...base, vvH: 812, vvTop: 403, innerH: 409, scrollY: 403, editing: true, quietMs: 0 })).toMatchObject({ h: 409, kb: true, fixed: true });
  });
  it('정상 iOS 26 — vvH 와 innerHeight 가 같이 줄면 그대로', () => {
    expect(readViewport({ ...base, vvH: 409, vvTop: 403, innerH: 409, scrollY: 403, editing: true, quietMs: 0 })).toMatchObject({ h: 409, top: 403, kb: true });
  });
  it('innerHeight 가 키보드를 안 따라가는 브라우저(iOS 18 이하)는 vvH 가 맞다', () => {
    expect(readViewport({ ...base, vvH: 394, vvTop: 403, innerH: 812, scrollY: 403, editing: true, quietMs: 0 })).toMatchObject({ h: 394, kb: true });
  });
  it('유령 키보드(키보드를 닫았는데 innerHeight·레이아웃 높이까지 작은 채)는 그대로 가장 큰 높이로', () => {
    const r = readViewport({ ...base, vvH: 409, vvTop: 0, innerH: 409, layoutH: 409, scrollY: 0, editing: false, quietMs: 800 });
    expect(r).toMatchObject({ h: 812, kb: false, ghost: true });
  });
});

describe('frameAt fullH — 유령 키보드면 같은 폭에서 본 가장 큰 높이로', () => {
  it('innerHeight·보이는 높이가 둘 다 키보드만큼 줄어 남아도(iOS 26) 화면 높이 932 로 되돌린다', () => {
    expect(frameAt({ vvTop: 0, vvH: 590, layoutH: 590, scrollY: 0, kb: false, editing: false, fullH: 932 })).toEqual({ top: 0, h: 932, scroll: false });
  });
  it('레이아웃 높이가 더 크면 그대로', () => {
    expect(frameAt({ vvTop: 0, vvH: 590, layoutH: 932, scrollY: 0, kb: false, editing: false, fullH: 900 })).toEqual({ top: 0, h: 932, scroll: false });
  });
});

describe('diagLine — 폰 진단 한 줄(숫자·짧은 낱말만, 글 내용은 못 들어간다)', () => {
  it('키=값을 띄어 쓴다, 숫자는 반올림, 참거짓은 1·0', () => {
    expect(diagLine({ ev: 'focusout', vvH: 590.4, typing: false, sa: true })).toBe('ev=focusout vvH=590 typing=0 sa=1');
  });
  it('낱말이 아닌 값(띄어쓰기·한글·기호·긴 글)은 버린다 — 입력칸 글이 실수로 실려도 안 나간다', () => {
    expect(diagLine({ ev: '안녕 비밀번호', tag: 'TEXTAREA', x: 'a b', y: 'x'.repeat(40), z: 'a=b' })).toBe('tag=TEXTAREA');
  });
  it('이상한 키·숫자 아닌 수는 버린다', () => {
    expect(diagLine({ 'bad key': 1, n: NaN, i: Infinity, ok: 3 })).toBe('ok=3');
  });
  it('점 들어간 판 번호는 된다', () => {
    expect(diagLine({ ios: '26.0.1' })).toBe('ios=26.0.1');
  });
});

describe('driftBias — 그려진 자리 검사(사건이 안 와도 스스로 되돌아오게)', () => {
  const h = 812;
  it('화면 틀이 61 내려가 그려진 게 두 번 연달아 보이면 그만큼 올린다', () => {
    expect(driftBias({ bias: 0, rectTop: 61, prevRect: null, editing: false, h })).toBe(0); // 한 번은 기다린다(돌리는 중 같은 잠깐 어긋남)
    expect(driftBias({ bias: 0, rectTop: 61, prevRect: 61, editing: false, h })).toBe(-61);
  });
  it('보정한 뒤 iOS 가 스스로 돌아오면(-61 로 보이면) 보정을 푼다', () => {
    expect(driftBias({ bias: -61, rectTop: -61, prevRect: -61, editing: false, h })).toBe(0);
  });
  it('맞게 그려져 있으면(1px 안) 그대로', () => {
    expect(driftBias({ bias: -61, rectTop: 0.5, prevRect: 0, editing: false, h })).toBe(-61);
    expect(driftBias({ bias: 0, rectTop: 1, prevRect: 1, editing: false, h })).toBe(0);
  });
  it('두 번 본 값이 다르면(움직이는 중) 기다린다', () => {
    expect(driftBias({ bias: 0, rectTop: 61, prevRect: 30, editing: false, h })).toBe(0);
  });
  it('쓰는 중이면 보정을 버린다 — iOS 키보드 올림과 싸우지 않게', () => {
    expect(driftBias({ bias: -61, rectTop: 200, prevRect: 200, editing: true, h })).toBe(0);
  });
  it('화면 반 넘게 어긋난 값은 믿지 않는다', () => {
    expect(driftBias({ bias: 0, rectTop: 500, prevRect: 500, editing: false, h })).toBe(0);
  });
});

describe('isTyping — 키보드를 부르는 칸에 포커스가 있나', () => {
  it('글 칸·contenteditable·iframe(안쪽 칸은 못 본다)은 쓰는 중', () => {
    expect(isTyping({ tag: 'TEXTAREA', type: '', editable: false })).toBe(true);
    expect(isTyping({ tag: 'INPUT', type: 'text', editable: false })).toBe(true);
    expect(isTyping({ tag: 'DIV', type: '', editable: true })).toBe(true);
    expect(isTyping({ tag: 'IFRAME', type: '', editable: false })).toBe(true);
  });
  it('버튼·체크칸·파일 고르기·몸통은 아니다', () => {
    expect(isTyping({ tag: 'BODY', type: '', editable: false })).toBe(false);
    expect(isTyping({ tag: 'BUTTON', type: '', editable: false })).toBe(false);
    expect(isTyping({ tag: 'INPUT', type: 'checkbox', editable: false })).toBe(false);
    expect(isTyping({ tag: 'INPUT', type: 'file', editable: false })).toBe(false);
  });
});

describe('liveWork — 폰 일하는 중 표시(데스크톱 chatBusy + 기록 꼬리)', () => {
  const T0 = Date.parse('2026-10-02T14:00:00Z');
  const at = (s: number) => new Date(T0 + s * 1000).toISOString();
  const user = (s: number, text = '해 줘'): ChatItem => ({ kind: 'user', id: `u${s}`, ts: at(s), text });
  const ai = (s: number, text = '했어'): ChatItem => ({ kind: 'assistant', id: `a${s}`, ts: at(s), text });
  const tools = (s: number, ...ts: [string, string][]): ChatItem => ({ kind: 'tools', id: `t${s}`, ts: at(s), tools: ts.map(([name, target]) => ({ name, target })) });

  it('세션이 working 이고 꼬리가 답이 아니면 — 마지막 도구 한 줄·이번 턴 도구 수·경과', () => {
    const items = [ai(-60), user(0), tools(3, ['Read', 'a.ts']), tools(9, ['Bash', 'npm test'], ['mcp__playwright__browser_click', '저장'])];
    expect(liveWork({ state: 'working', items, pending: 0, stateAt: T0 + 5000, now: T0 + 12_000 })).toEqual({ busy: true, line: 'browser_click 저장', tools: 3, secs: 12 });
  });
  it('도구 없이 내 말로 끝났으면 생각 중(빈 줄)', () => {
    expect(liveWork({ state: 'working', items: [user(0)], pending: 0, stateAt: T0, now: T0 + 4000 })).toEqual({ busy: true, line: '', tools: 0, secs: 4 });
  });
  it('세션 상태가 아직 idle 이어도 그 뒤에 새로 생긴 꼬리(내 말·도구)면 일하는 중 — 3초 상태 폴링을 기다리지 않는다', () => {
    expect(liveWork({ state: 'idle', items: [ai(-30), user(0)], pending: 0, stateAt: T0 - 1000, now: T0 + 1000 }).busy).toBe(true);
    // 상태를 그 뒤에 읽었는데 idle 이면 끝난 것(끊긴 턴의 도구 꼬리에 계속 일하는 중이 남지 않게)
    expect(liveWork({ state: 'idle', items: [user(0), tools(2, ['Bash', 'x'])], pending: 0, stateAt: T0 + 5000, now: T0 + 6000 }).busy).toBe(false);
  });
  it('보내는 중(아직 기록에 안 붙음)도 일하는 중, 답으로 끝났으면 아님', () => {
    expect(liveWork({ state: 'idle', items: [ai(0)], pending: 1, stateAt: T0, now: T0 + 500 })).toEqual({ busy: true, line: '', tools: 0, secs: 0 });
    expect(liveWork({ state: 'working', items: [user(0), ai(5)], pending: 0, stateAt: T0 + 6000, now: T0 + 7000 }).busy).toBe(false);
  });
});

describe('closeOnRelease — 참모 바꾸기 시트를 아래로 끌어 놓았을 때 닫나', () => {
  it('80px 넘게 내리거나 아래로 빠르게 튕기면 닫고, 조금·위로는 제자리', () => {
    expect(closeOnRelease(90, 0.05)).toBe(true);
    expect(closeOnRelease(20, 0.6)).toBe(true);
    expect(closeOnRelease(40, 0.1)).toBe(false);
    expect(closeOnRelease(120, -0.6)).toBe(false); // 내렸다가 위로 튕김 — 마지막 손짓을 따른다
  });
});

describe('phoneName — 폰 화면 참모 이름은 번호 없이(2026-10-03 사용자 "여전히 참모2 라고 써 있네")', () => {
  const orchs = [{ name: '참모-1 · 개발 담당' }, { name: '참모-2 · 참모 업데이트' }, { name: '참모-4' }];
  it('별명이 있으면 별명만', () => {
    expect(phoneName('참모-2 · 참모 업데이트', orchs)).toBe('참모 업데이트');
  });
  it('별명이 없는 참모는 비서 이름 그대로', () => {
    expect(phoneName('참모-4', orchs)).toBe('참모');
  });
  it('참모가 아닌 세션(프로젝트·도우미)은 이름 그대로 — 끝 번호도 이름의 일부', () => {
    expect(phoneName('project-b-2', orchs)).toBe('project-b-2');
    expect(phoneName('sns-post', orchs)).toBe('sns-post');
  });
});

describe('offOrchRows — 폰 참모 깨우기 목록(데스크톱 오케스트레이터 홈과 같은 셈)', () => {
  const env = { devRoot: '/Users/me/dev', extraProjects: [], hqDir: '/Users/me/hq' };
  const stopped = JSON.stringify([
    { id: 'aaaa0002', sessionId: 's2', cwd: '/Users/me/hq', name: '참모-2 · 참모 업데이트', state: 'stopped', startedAt: 10 },
    { id: 'aaaa0003', sessionId: 's3', cwd: '/Users/me/hq', name: '참모-3 · 나스', state: 'done', startedAt: 20 },
    { id: 'aaaa0004', sessionId: 's4', cwd: '/Users/me/hq', name: 'sns-post', state: 'done', startedAt: 30 },
  ]);
  const userLine = (ts: string, text: string) => JSON.stringify({ type: 'user', uuid: ts, timestamp: ts, message: { role: 'user', content: text } });
  it('참모 이름인 꺼진 대화만, 마지막으로 일한 때 최근 순 · 하던 일 한 줄', () => {
    const tails = { s2: userLine('2026-10-03T05:20:00Z', '폰 앱 최대치 올려줘'), s3: userLine('2026-10-02T05:20:00Z', '나스 백업 봐 줘') };
    const rows = offOrchRows(stopped, env, [], tails);
    expect(rows.map((r) => [r.off?.id, r.doing])).toEqual([['aaaa0002', '폰 앱 최대치 올려줘'], ['aaaa0003', '나스 백업 봐 줘']]);
  });
  it('지금 살아 있는 대화는 뺀다', () => {
    const live = [{ id: 'x', sessionId: 's2', name: '참모-2 · 참모 업데이트', cwd: '/Users/me/hq', kind: 'background', state: 'idle', startedAt: 1 }] as unknown as Session[];
    expect(offOrchRows(stopped, env, live, {}).map((r) => r.off?.id)).toEqual(['aaaa0003']);
  });
  it('깨진 목록이면 빈 줄', () => {
    expect(offOrchRows('{깨진', env, [], {})).toEqual([]);
  });
});

describe('wokeOrch — 깨운 참모가 살아 있는 목록에 뜨면 그 참모', () => {
  const live = [{ id: 'n1', sessionId: 's2', name: '참모-2 · 참모 업데이트' }, { id: 'n2', sessionId: 's9', name: '참모-5 · 디자인' }] as unknown as Session[];
  it('되살린 대화는 sessionId 로, 새로 만든 참모는 이름으로', () => {
    expect(wokeOrch({ sessionId: 's2' }, live)).toBe('n1');
    expect(wokeOrch({ name: '참모-5 · 디자인' }, live)).toBe('n2');
    expect(wokeOrch({ name: '참모-6 · 없음' }, live)).toBeUndefined();
    expect(wokeOrch(null, live)).toBeUndefined();
  });
});

describe('waitAnswer — 답 기다림 카드에서 바로 답하기(그 참모에게 보낸다)', () => {
  const base = { orch: 'o', name: '참모-2', ts: '' };
  it('참모가 끝에 물은 것은 답 그대로', () => {
    expect(waitAnswer({ ...base, kind: 'ask', q: '머지할까?' }, ' 응 머지해 ')).toBe('응 머지해');
  });
  it('결정 대기함(task ask)은 무슨 물음에 대한 답인지 붙인다', () => {
    expect(waitAnswer({ ...base, kind: 'decide', q: 'PR #12 머지할까?' }, '해')).toBe('[결정 대기함] PR #12 머지할까?\n→ 해');
  });
  it('확인창에서 멈춘 것은 글로 못 답한다', () => {
    expect(waitAnswer({ ...base, kind: 'blocked', q: '…' }, '응')).toBeNull();
    expect(waitAnswer({ ...base, kind: 'ask', q: 'x' }, '   ')).toBeNull();
  });
});

describe('sessionBoard — 폰 세션 화면(참모 말고 하위 세션)', () => {
  const s = (id: string, name: string, cwd: string, state: string) => ({ id, name, cwd, state, kind: 'background', project: cwd.split('/').pop(), workspace: null, startedAt: 1 }) as unknown as Session;
  const hq = '/Users/me/hq';
  const list = [
    s('o1', '참모-1 · 개발', hq, 'working'),
    s('a1', 'shop', '/Users/me/dev/shop', 'idle'),
    s('a2', 'shop-2', '/Users/me/dev/shop', 'working'),
    s('b1', 'project-b', '/Users/me/dev/project-b', 'blocked'),
    s('h1', 'sns-post', hq, 'idle'),
  ];
  it('참모는 빼고 프로젝트별, 묻는·일하는 세션이 있는 프로젝트가 위 · 안에서도 물음 → 일함 → 쉼', () => {
    const b = sessionBoard(list, hq);
    expect(b.map((g) => [g.name, g.sessions.map((x) => x.id)])).toEqual([
      ['project-b', ['b1']],
      ['shop', ['a2', 'a1']],
      ['도우미', ['h1']],
    ]);
  });
});

describe('sessionBoard — 윈도우 HQ 경로 모양이 달라도 참모는 빼고 도우미는 도우미로(2026-10-05)', () => {
  const s = (id: string, name: string, cwd: string) => ({ id, name, cwd, state: 'idle', kind: 'background', project: cwd.split('/').pop(), workspace: null, startedAt: 1 }) as unknown as Session;
  it('hqDir 가 C:\\Users\\Me/.chammo/hq 로 와도', () => {
    const hq = 'C:/Users/Me/.chammo/hq';
    const b = sessionBoard([s('o1', '참모', hq), s('h1', 'sns-post', hq), s('a1', 'shop', 'C:/Users/Me/dev/shop')], 'C:\\Users\\Me/.chammo/hq');
    expect(b.map((g) => [g.name, g.sessions.map((x) => x.id)])).toEqual([['shop', ['a1']], ['도우미', ['h1']]]);
  });
});

describe('stickBottom — 대화 목록 바닥 붙이기(키보드·새 말풍선·보내기)', () => {
  it('바닥 근처(80px 안)를 보던 중이면 붙인다', () => {
    expect(nearBottom(1000, 600, 380)).toBe(true); // 20px 남음
    expect(nearBottom(1000, 400, 380)).toBe(false); // 220px 위
  });
  it('위로 올려 옛 글을 보는 중이면 안 끌어내린다 — 내가 막 보낸 것만 예외', () => {
    expect(stickBottom({ wasNear: true, sentMine: false })).toBe(true);
    expect(stickBottom({ wasNear: false, sentMine: false })).toBe(false);
    expect(stickBottom({ wasNear: false, sentMine: true })).toBe(true);
  });
});

describe('shrinkPlan — 폰 사진은 올리기 전에 줄인다(긴 변 2048·JPEG 0.85, LTE Load failed 2026-10-03)', () => {
  it('긴 변을 2048 로, 비율 그대로', () => {
    expect(shrinkPlan(4032, 3024, 3_000_000, 'image/jpeg')).toEqual({ w: 2048, h: 1536 });
    expect(shrinkPlan(3024, 4032, 3_000_000, 'image/heic')).toEqual({ w: 1536, h: 2048 });
  });
  it('이미 작으면 그대로(null) — 다만 HEIC 는 크기와 상관없이 JPEG 로', () => {
    expect(shrinkPlan(1200, 900, 400_000, 'image/jpeg')).toBeNull();
    expect(shrinkPlan(1200, 900, 400_000, 'image/heic')).toEqual({ w: 1200, h: 900 });
  });
  it('작은 크기라도 파일이 크면(1.5MB 넘음) 다시 굽는다, GIF 는 움직임이 깨지니 손대지 않는다', () => {
    expect(shrinkPlan(1800, 1200, 4_000_000, 'image/png')).toEqual({ w: 1800, h: 1200 });
    expect(shrinkPlan(4000, 3000, 9_000_000, 'image/gif')).toBeNull();
  });
});

describe('앞 대화 — 위로 올리면 거슬러 읽은 묶음을 앞에 붙인다(2026-10-03 사용자 "이전 대화 히스토리가 안 나와")', () => {
  const it2 = (id: string): ChatItem => ({ kind: 'assistant', id, ts: '', text: id });
  it('앞에 붙이고, 파일 처음(0)에 닿으면 끝', () => {
    const s0 = { older: [it2('c')], start: 300, done: false };
    const s1 = withEarlier(s0, [it2('a'), it2('b')], 120);
    expect(s1).toEqual({ older: [it2('a'), it2('b'), it2('c')], start: 120, done: false });
    expect(withEarlier(s1, [it2('z')], 0).done).toBe(true);
  });
  it('같은 id 는 두 번 안 붙인다(경계가 겹쳐 읽혀도)', () => {
    expect(withEarlier({ older: [it2('b')], start: 50, done: false }, [it2('a'), it2('b')], 10).older.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('wantEarlier — 위로 무한 스크롤(2026-10-03 사용자 "위로 무한 스크롤로 하면 어때?")', () => {
  const base = { scrollTop: 300, clientHeight: 600, loading: false, done: false };
  it('위로 화면 한 장도 안 남았으면 미리 불러온다', () => {
    expect(wantEarlier(base)).toBe(true);
    expect(wantEarlier({ ...base, scrollTop: 900 })).toBe(false);
  });
  it('불러오는 중·처음까지 다 읽음이면 안 부른다', () => {
    expect(wantEarlier({ ...base, loading: true })).toBe(false);
    expect(wantEarlier({ ...base, done: true })).toBe(false);
  });
  it('목록이 화면보다 짧으면(scrollTop 0) 찰 때까지 부른다', () => {
    expect(wantEarlier({ ...base, scrollTop: 0 })).toBe(true);
  });
});

describe('nextAfterStop — 지금 보던 참모를 재우면 다른 켜진 참모로(없으면 참모 없음 화면)', () => {
  const o = (id: string) => ({ id }) as unknown as Session;
  it('보던 참모를 재우면 남은 첫 참모, 다른 참모를 재우면 그대로', () => {
    expect(nextAfterStop([o('a'), o('b')], 'a', 'a')).toBe('b');
    expect(nextAfterStop([o('a'), o('b')], 'b', 'a')).toBe('a');
    expect(nextAfterStop([o('a')], 'a', 'a')).toBeNull();
  });
});

describe('lineSlot — 참모 줄 마지막 말 자리(높이 고정, 2026-10-03 사용자 "이름만 나오다 커진다")', () => {
  it('아직 안 받았으면 뼈대, 받았는데 비었으면 빈 자리(같은 높이), 있으면 글', () => {
    expect(lineSlot(undefined)).toEqual({ skel: true, text: '' });
    expect(lineSlot('')).toEqual({ skel: false, text: ' ' });
    expect(lineSlot('하던 일')).toEqual({ skel: false, text: '하던 일' });
  });
});

describe('orchMenu — 참모 줄 길게 누르기 메뉴(밀기 동작 + 이름 바꾸기, 2026-10-04 사용자)', () => {
  it('켜진 참모: 이름 바꾸기·맡은 일·고정·재우기·제거(경고)', () => {
    expect(orchMenu({ live: true, pinned: false, canPin: true }).map((m) => m.key)).toEqual(['rename', 'role', 'pin', 'sleep', 'remove']);
    expect(orchMenu({ live: true, pinned: true, canPin: true }).map((m) => m.key)).toEqual(['rename', 'role', 'unpin', 'sleep', 'remove']);
    expect(orchMenu({ live: true, pinned: false, canPin: true }).find((m) => m.key === 'remove')?.danger).toBe(true);
  });
  it('꺼진 참모: 깨우기·제거만(이름은 켜진 세션에만 /rename), 대화 id 없으면 고정 없음', () => {
    expect(orchMenu({ live: false, pinned: false, canPin: true }).map((m) => m.key)).toEqual(['wake', 'pin', 'remove']);
    expect(orchMenu({ live: true, pinned: false, canPin: false }).map((m) => m.key)).toEqual(['rename', 'role', 'sleep', 'remove']);
  });
});

describe('폰에서 바꾼 이름 — 맥이 /rename 으로 진짜 이름에 실을 때까지 메뉴·대시보드·프로필 창이 같이 새 이름', () => {
  const o = (id: string, name: string) => ({ id, name }) as Session;
  const orchs = [o('a', '참모-2 · 참모 업데이트'), o('b', '참모-5 · 개발 담당')];

  it('바꾼 이름이 있으면 그 이름, 비우면 처음 이름(번호 뺀 기본 이름), 없으면 지금 이름', () => {
    expect(pendingName(orchs[0]!, { a: '참모 고치기' }, orchs)).toBe('참모 고치기');
    expect(pendingName(orchs[0]!, { a: '' }, orchs)).toBe(phoneName('참모-2', orchs));
    expect(pendingName(orchs[1]!, { a: '참모 고치기' }, orchs)).toBe('개발 담당');
  });

  it('진짜 이름에 실리면 뺀다 — 그대로면 같은 객체(다시 그리지 않게)', () => {
    const n = { a: '참모 업데이트', b: '새 이름' };
    expect(prunePendingNicks(n, orchs)).toEqual({ b: '새 이름' });
    const keep = { b: '새 이름' };
    expect(prunePendingNicks(keep, orchs)).toBe(keep);
    expect(prunePendingNicks({ a: '' }, [o('a', '참모-2')])).toEqual({});
  });
});

import { wakeFailText } from './mobile';

describe('참모 켜기·만들기 실패 글', () => {
  it('꺼진 목록에 없던 참모(이미 켜졌거나 지워짐)는 오류가 아니라 목록 새로 고침', () => {
    const r = wakeFailText('no such stopped assistant', 'wake');
    expect(r.refresh).toBe(true);
    expect(r.text).not.toMatch(/[a-z]{3}/i); // 서버 영어 원문을 그대로 안 보인다
    expect(r.text).toContain('목록');
  });
  it('서버 낱말마다 사람 말로 — 영어 원문은 안 보인다', () => {
    for (const m of ['too soon', 'mac side took too long', 'name taken', 'bad name', 'Load failed', 'Failed to fetch', 'claude: something exploded', 'HTTP 502', '']) {
      const r = wakeFailText(m, m.includes('name') ? 'make' : 'wake');
      expect(r.text, m).not.toMatch(/[a-z]{3}/i);
      expect(r.text.length, m).toBeGreaterThan(0);
    }
    expect(wakeFailText('name taken', 'make').text).toBe('이미 있는 이름이에요');
    expect(wakeFailText('too soon', 'wake').refresh).toBe(false);
  });
  it('켜기와 만들기는 모르는 실패에서 글이 갈린다', () => {
    expect(wakeFailText('boom', 'wake').text).not.toBe(wakeFailText('boom', 'make').text);
  });
});

describe('결정 카드 답 — 한 번만(2026-10-06 사용자 폰에서 ㄱㄱ 세 번)', () => {
  const ask = { orch: 'o1', name: '참모-1', kind: 'ask' as const, ts: '2026-10-06T07:00:00Z', q: '배포할까?' };
  const decide = { orch: 'o1', name: '참모-1', kind: 'decide' as const, ts: '2026-10-06T07:01:00Z', q: '머지할까?', taskId: '1006-1615-5e02' };
  it('카드 열쇠 — 결정은 일 id, 참모 물음은 참모·시각(시트를 다시 열어도 같은 카드)', () => {
    expect(waitKey(decide)).toBe('task:1006-1615-5e02');
    expect(waitKey({ ...decide, ts: 'other' })).toBe('task:1006-1615-5e02');
    expect(waitKey(ask)).toBe('ask:o1:2026-10-06T07:00:00Z');
    expect(waitKey(ask)).not.toBe(waitKey({ ...ask, ts: '2026-10-06T08:00:00Z' }));
  });
  it('답한 결정 카드는 기록이 따라올 때까지 숨긴다 — 참모 물음 카드는 남겨 "보냈어요"', () => {
    const sent = { [waitKey(decide)]: { a: 'ㄱㄱ', at: 1 }, [waitKey(ask)]: { a: '응', at: 1 } };
    expect(shownWaiting([ask, decide], sent)).toEqual([ask]);
    expect(shownWaiting([ask, decide], {})).toEqual([ask, decide]);
    // 기록이 실패해 되돌린 카드는 다시 보인다
    expect(shownWaiting([ask, decide], { [waitKey(decide)]: { a: 'ㄱㄱ', at: 1, fail: true } })).toEqual([ask, decide]);
  });
  it('목록에서 빠진 카드의 보낸 표시는 지운다(같은 객체면 그대로)', () => {
    const sent = { [waitKey(decide)]: { a: 'ㄱㄱ', at: 1 }, [waitKey(ask)]: { a: '응', at: 1 } };
    expect(pruneWaitSent(sent, [ask, decide])).toBe(sent);
    expect(pruneWaitSent(sent, [ask])).toEqual({ [waitKey(ask)]: { a: '응', at: 1 } });
  });
  it('같은 카드에 같은 답을 2분 안에 또 — 막는다. 다른 답·다른 카드·2분 뒤는 된다', () => {
    const sent = { [waitKey(decide)]: { a: 'ㄱㄱ', at: 1_000 } };
    expect(dupAnswer(sent, waitKey(decide), ' ㄱㄱ ', 1_000 + 30_000)).toBe(true);
    expect(dupAnswer(sent, waitKey(decide), '아니', 1_000 + 30_000)).toBe(false);
    expect(dupAnswer(sent, waitKey(ask), 'ㄱㄱ', 1_000 + 30_000)).toBe(false);
    expect(dupAnswer(sent, waitKey(decide), 'ㄱㄱ', 1_000 + 120_001)).toBe(false);
    expect(dupAnswer({ [waitKey(decide)]: { a: 'ㄱㄱ', at: 1_000, fail: true } }, waitKey(decide), 'ㄱㄱ', 2_000)).toBe(false); // 실패한 것은 다시 보낼 수 있다
  });
  it('기록 실패 — 이미 답함(409)·방금 보냄(429)은 숨긴 채 글을 안 보낸다, 나머지는 되돌려 다시', () => {
    expect(answerFail('not waiting')).toBe('gone');
    expect(answerFail('too soon')).toBe('soon');
    expect(answerFail('Failed to fetch')).toBe('retry');
    expect(answerFail('HTTP 502')).toBe('retry');
  });
});

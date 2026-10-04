import { describe, expect, it } from 'vitest';
import { cleanLabel, displayName, dupRenames, labelRenames, nickProblem, RENAME_MAX, RENAME_RETRY_MS, renamesToSend, renameTo, shownName, splitOrchName, withNick } from './orchLabel';

describe('cleanLabel — 참모 별명(개발·디자인 등, 사용자 마음대로. 비우면 설정 이름으로 돌아감)', () => {
  it('앞뒤 공백을 떼고 24자까지, 비었으면 null(설정 이름)', () => {
    expect(cleanLabel('  개발  ')).toBe('개발');
    expect(cleanLabel('   ')).toBeNull();
    expect(cleanLabel('가'.repeat(30))).toBe('가'.repeat(24));
  });
  it('줄바꿈은 띄어쓰기로', () => {
    expect(cleanLabel('디자인\n담당')).toBe('디자인 담당');
  });
});

describe('진짜 이름에 별명 싣기 — 참모-3 · 별명 (2026-10-02 사용자 "서로 자기 별명을 모른다")', () => {
  // 별명이 앱(localStorage)에만 있으면 세션끼리 주고받는 메시지·claude agents 엔 참모-3 만 찍혀 헷갈렸다.
  // 그래서 /rename 으로 진짜 이름을 "기본 이름 · 별명"으로 바꾼다 — 앞의 기본 이름으로 참모인지 가른다
  it('나누기 — 기본 이름과 별명', () => {
    expect(splitOrchName('참모-3 · 참모 업데이트')).toEqual({ base: '참모-3', nick: '참모 업데이트' });
    expect(splitOrchName('참모-3')).toEqual({ base: '참모-3', nick: undefined });
    expect(splitOrchName('참모')).toEqual({ base: '참모', nick: undefined });
  });
  it('합치기 — 별명이 비면 기본 이름으로', () => {
    expect(withNick('참모-3', '하니터')).toBe('참모-3 · 하니터');
    expect(withNick('참모-3 · 옛 별명', '새 별명')).toBe('참모-3 · 새 별명');
    expect(withNick('참모-3 · 옛 별명', '')).toBe('참모-3');
  });
  it('맞출 필요 — 앱 별명과 진짜 이름이 다를 때만', () => {
    expect(renameTo('참모-3', '참모 업데이트')).toBe('참모-3 · 참모 업데이트');
    expect(renameTo('참모-3 · 참모 업데이트', '참모 업데이트')).toBeNull();
    expect(renameTo('참모-3', undefined)).toBeNull();
  });
});

describe('displayName — 화면에선 번호 없이(2026-10-02 사용자 "참모 번호를 화면에서 없앤다")', () => {
  it('별명이 있으면 별명만', () => {
    expect(displayName('참모-3 · 디자인')).toBe('디자인');
    expect(displayName('참모-3', '개발')).toBe('개발'); // 앱 별명(아직 진짜 이름에 안 실림)
  });
  it('별명이 없으면 기본 이름에서 번호를 뺀 이름', () => {
    expect(displayName('참모')).toBe('참모');
    expect(displayName('참모-2')).toBe('참모');
    expect(displayName('Chammo 3')).toBe('Chammo');
    expect(displayName('')).toBe('');
  });
  it('같은 이름이 둘 이상일 때만 짧은 꼬리(번호 대신 글자) — 첫 참모는 그대로', () => {
    const roster = [{ name: '참모' }, { name: '참모-2' }, { name: '참모-3 · 디자인' }];
    expect(displayName('참모', undefined, roster)).toBe('참모');
    expect(displayName('참모-2', undefined, roster)).toBe('참모 B');
    expect(displayName('참모-3 · 디자인', undefined, roster)).toBe('디자인');
  });
  it('별명이 겹쳐도 꼬리', () => {
    const roster = [{ name: '참모-2 · 개발' }, { name: '참모-4 · 개발' }];
    expect(displayName('참모-2 · 개발', undefined, roster)).toBe('개발 B');
    expect(displayName('참모-4 · 개발', undefined, roster)).toBe('개발 D');
  });
  it('안 겹치면 꼬리 없음(목록에 자기 자신만 있어도)', () => {
    expect(displayName('참모-2', undefined, [{ name: '참모-2' }])).toBe('참모');
  });
});

describe('nickProblem — 새 참모 이름 짓기', () => {
  it('빈칸이면 안 만든다', () => {
    expect(nickProblem('   ', [])).not.toBeNull();
  });
  it('이미 있는 이름과 겹치면 막는다(대소문자·앞뒤 빈칸 무시)', () => {
    expect(nickProblem('개발', ['개발', '디자인'])).not.toBeNull();
    expect(nickProblem(' Dev ', ['dev'])).not.toBeNull();
  });
  it('구분자(·)는 못 쓴다 — 진짜 이름이 "참모-N · 별명" 이라', () => {
    expect(nickProblem('개발 · 2', [])).not.toBeNull();
  });
  it('괜찮으면 null', () => {
    expect(nickProblem('루틴', ['개발'])).toBeNull();
  });
});

describe('dupRenames — 살아 있는 참모 둘이 기본 이름이 같으면 늦게 켜진 쪽을 빈 번호로(별명 유지)', () => {
  const s = (id: string, name: string, startedAt: number) => ({ id, name, startedAt });
  it('실제 사고: 참모-3 둘 → 늦은 쪽(쇼핑몰)을 참모-6 으로, 꺼진 참모-4 번호도 피해서, 이상한 별명은 앱 별명으로', () => {
    const live = [s('f00d0002', '참모-3 · 서버 정리', 1700000000000), s('f00d0003', '참모-3 · 쇼핑몰 문의 좀 모였나? 답한 거?', 1700000005000), s('bb', '참모-5 · 개발 담당', 1), s('87', '참모-2 · 참모 업데이트', 1), s('m', '참모', 1)];
    const taken = ['참모-4 · 루틴담당', '참모-2'];
    expect(dupRenames(live, taken, { f00d0003: '쇼핑몰 문의' })).toEqual([{ id: 'f00d0003', to: '참모-6 · 쇼핑몰 문의' }]);
  });
  it('앱 별명이 없으면 물음표 앞까지로 줄인다, 그것도 이상하면 별명 없이', () => {
    const live = [s('a', '참모-3 · 서버', 1), s('b', '참모-3 · 쇼핑몰 문의 좀 모였나? 답한 거?', 2)];
    expect(dupRenames(live, [], {})).toEqual([{ id: 'b', to: '참모-4 · 쇼핑몰 문의 좀 모였나' }]);
    const odd = [s('a', '참모-3', 1), s('b', '참모-3 · ??', 2)];
    expect(dupRenames(odd, [], {})).toEqual([{ id: 'b', to: '참모-4' }]);
  });
  it('겹치는 게 없으면 아무것도', () => {
    expect(dupRenames([s('a', '참모', 1), s('b', '참모-2 · 개발', 2)], [], {})).toEqual([]);
  });
  it('셋이 겹치면 둘을 서로 다른 빈 번호로', () => {
    const live = [s('a', '참모-2 · 가', 1), s('b', '참모-2 · 나', 2), s('c', '참모-2 · 다', 3)];
    expect(dupRenames(live, [], {})).toEqual([{ id: 'b', to: '참모-3 · 나' }, { id: 'c', to: '참모-4 · 다' }]);
  });
});

describe('shownName — 세션 목록 이름을 화면에(별명이 있으면 별명만, 번호가 안 보이게)', () => {
  it('참모 진짜 이름이면 별명', () => expect(shownName('참모-3 · 셋째바뀜')).toBe('셋째바뀜'));
  it('별명 없는 이름은 그대로 — 프로젝트 세션의 끝 번호는 이름의 일부', () => {
    expect(shownName('project-b-1')).toBe('project-b-1');
    expect(shownName('참모')).toBe('참모');
  });
});

describe('renamesToSend — 같은 번호 정리 /rename 을 언제 보낼까(2026-10-03 QA: 첫 턴 중 보낸 /rename 이 되돌아가고 다시 안 보냈다)', () => {
  const plan = [{ id: 'n4', to: '참모-4 · 넷째' }];
  it('일하는 중이면 안 보낸다 — 첫 턴이 끝날 때 -n 이름으로 되돌아간다', () => {
    const r = renamesToSend(plan, () => false, {}, 1000);
    expect(r.send).toEqual([]);
    expect(r.sent).toEqual({});
  });
  it('쉬는 중이면 보내고 보낸 시각·횟수를 적는다', () => {
    const r = renamesToSend(plan, () => true, {}, 1000);
    expect(r.send).toEqual(plan);
    expect(r.sent['n4>참모-4 · 넷째']).toEqual({ at: 1000, n: 1 });
  });
  it('보낸 지 얼마 안 됐으면 다시 안 보낸다(이름이 목록에 반영되는 시차)', () => {
    const r = renamesToSend(plan, () => true, { 'n4>참모-4 · 넷째': { at: 1000, n: 1 } }, 1000 + RENAME_RETRY_MS - 1);
    expect(r.send).toEqual([]);
  });
  it('시간이 지나도 같은 번호가 남아 있으면(이름이 안 바뀜) 다시 보낸다', () => {
    const r = renamesToSend(plan, () => true, { 'n4>참모-4 · 넷째': { at: 1000, n: 1 } }, 1000 + RENAME_RETRY_MS);
    expect(r.send).toEqual(plan);
    expect(r.sent['n4>참모-4 · 넷째']).toEqual({ at: 1000 + RENAME_RETRY_MS, n: 2 });
  });
  it('몇 번 해도 안 되면 멈춘다 — 끝없이 치지 않게', () => {
    const r = renamesToSend(plan, () => true, { 'n4>참모-4 · 넷째': { at: 0, n: RENAME_MAX } }, 10 ** 9);
    expect(r.send).toEqual([]);
  });
  it('정리가 끝나 계획에서 빠진 기록은 버린다', () => {
    const r = renamesToSend([], () => true, { 'n4>참모-4 · 넷째': { at: 1000, n: 1 } }, 5000);
    expect(r.sent).toEqual({});
  });
});

describe('labelRenames — 앱 별명과 진짜 이름이 다른 참모 → 보낼 /rename(쉬는 때 renamesToSend 로)', () => {
  it('별명이 진짜 이름에 안 실린 참모만, 앞 번호는 진짜 이름에서', () => {
    const orchs = [{ id: 'a', name: '참모-3' }, { id: 'b', name: '참모-4 · 디자인' }, { id: 'c', name: '참모-5 · 개발' }];
    expect(labelRenames(orchs, { a: '서버', b: '디자인', c: '운영' })).toEqual([{ id: 'a', to: '참모-3 · 서버' }, { id: 'c', to: '참모-5 · 운영' }]);
    expect(labelRenames(orchs, {})).toEqual([]);
  });
});

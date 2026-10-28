import { describe, expect, it } from 'vitest';
import { expandMentions, lockerChoices, matchMentions, mentionRoster, mentionPick, mentionQuery, mentionSpans, REF_PREFIX, refQuery, sentMentionLabel, splitTokens, type MentionWho } from './chatTokens';

// 지어낸 참모들 — 띠 순서 그대로
const WHO: MentionWho[] = [
  { id: 'a1', name: '참모-3 · 가나 담당', label: '가나 담당', role: '시험 앱 고치기' },
  { id: 'b2', name: '참모-4 · 가나', label: '가나', role: '문서' },
  { id: 'c3', name: '참모-6 · 마바 담당', label: '마바 담당' },
  { id: 'd4', name: '참모-9', label: '참모', off: true },
];

describe('mentionQuery — 커서 앞 @ 뒤 글(목록을 띄울지)', () => {
  it('@ 만 쳐도 빈 글로 뜬다, 줄 처음이나 띄어 쓴 뒤만', () => {
    expect(mentionQuery('@', 1)).toBe('');
    expect(mentionQuery('이거 @가', 5)).toBe('가');
    expect(mentionQuery('메일 a@b', 7)).toBeNull();
  });
  it('이름에 띄어쓰기가 있어도 이어서 거른다, 줄바꿈·긴 글은 끝', () => {
    expect(mentionQuery('@가나 담', 5)).toBe('가나 담');
    expect(mentionQuery('@가나\n뒤', 5)).toBeNull();
    expect(mentionQuery(`@${'가'.repeat(30)}`, 31)).toBeNull();
  });
  it('커서가 @ 앞이면 안 뜬다', () => {
    expect(mentionQuery('앞 @가', 1)).toBeNull();
  });
});

describe('matchMentions — 걸러진 목록(띠 순서 그대로)', () => {
  it('빈 글이면 전부, 글자를 치면 이름·진짜 이름에 든 것만', () => {
    expect(matchMentions(WHO, '').map((w) => w.id)).toEqual(['a1', 'b2', 'c3', 'd4']);
    expect(matchMentions(WHO, '담당').map((w) => w.id)).toEqual(['a1', 'c3']);
    expect(matchMentions(WHO, '참모-6').map((w) => w.id)).toEqual(['c3']);
  });
  it('다 친 이름 뒤 띄어쓰기면 더 안 뜬다(고른 뒤 목록이 다시 안 열리게)', () => {
    expect(matchMentions(WHO, '마바 담당 ')).toEqual([]);
  });
});

describe('mentionPick — 고르면 @이름 + 띄어쓰기로', () => {
  it('친 @글자를 이름으로 바꾸고 커서는 그 뒤', () => {
    expect(mentionPick('이거 @가 해 줘', 5, '가나 담당')).toEqual({ text: '이거 @가나 담당 해 줘', caret: 10 });
    expect(mentionPick('@', 1, '마바 담당')).toEqual({ text: '@마바 담당 ', caret: 7 });
    expect(mentionPick('봐 #im', 5, '#img1', '#')).toEqual({ text: '봐 #img1 ', caret: 8 });
  });
});

describe('mentionSpans·expandMentions — 입력칸 칩 자리와 보낼 글', () => {
  it('긴 이름부터 맞춘다(가나 담당이 가나보다 먼저)', () => {
    expect(mentionSpans('@가나 담당 이거 @가나 에게', WHO)).toEqual([
      { who: WHO[0], at: 0, len: 6 },
      { who: WHO[1], at: 10, len: 3 },
    ]);
  });
  it('조사가 붙어도 칩, 영문·숫자가 이어지면 다른 낱말이라 아니다', () => {
    expect(mentionSpans('@마바 담당에게', WHO).length).toBe(1);
    expect(mentionSpans('@참모x', WHO)).toEqual([]);
    expect(mentionSpans('a@가나', WHO)).toEqual([]);
  });
  it('보낼 땐 진짜 SendMessage 이름을 대괄호로 — 참모가 누구에게 전할지 헷갈리지 않게', () => {
    expect(expandMentions('@가나 담당 이거 전해 줘', WHO)).toBe('@[참모-3 · 가나 담당] 이거 전해 줘');
    expect(expandMentions('멘션 없는 말', WHO)).toBe('멘션 없는 말');
  });
  it('보낸 이름은 말풍선에 화면 이름으로', () => {
    expect(sentMentionLabel('참모-3 · 가나 담당')).toBe('가나 담당');
    expect(sentMentionLabel('참모-9')).toBe('참모'); // 별명 없는 참모도 번호는 안 보인다(2026-10-28)
    expect(sentMentionLabel('shop-app-2')).toBe('shop-app-2'); // 프로젝트 세션 끝 번호는 이름의 일부
  });
});

describe('# 참조 — 그림·파일·말풍선(옛 @ 기록도 읽는다)', () => {
  it('새로 쓰는 이름표는 #', () => {
    expect(REF_PREFIX).toBe('#');
  });
  it('말풍선은 #img1·옛 @img1·@[참모] 를 다 칩으로 가른다', () => {
    expect(splitTokens('#img1 이랑 @file2 보고 @[참모-3 · 가나 담당] 에게')).toEqual([
      { ref: '#img1' }, ' 이랑 ', { ref: '@file2' }, ' 보고 ', { mention: '참모-3 · 가나 담당' }, ' 에게',
    ]);
    expect(splitTokens('#chat3')).toEqual([{ ref: '#chat3' }]);
    expect(splitTokens('#1등 #imgx')).toEqual(['#1등 #imgx']);
  });
  it('입력칸 뒤판은 지금 로스터 멘션까지 같이 칠한다', () => {
    expect(splitTokens('#img1 @마바 담당 봐', WHO)).toEqual([{ ref: '#img1' }, ' ', { live: '@마바 담당' }, ' 봐']);
  });
  it('# 뒤 글 — 띄어 쓴 뒤나 줄 처음만', () => {
    expect(refQuery('#', 1)).toBe('');
    expect(refQuery('이거 #im', 6)).toBe('im');
    expect(refQuery('색 a#fff', 7)).toBeNull();
    expect(refQuery('#견적 서', 5)).toBeNull();
  });
});

describe('lockerChoices — # 고르기에 뜨는 보관함 파일', () => {
  const E = (rel: string, mtime: number, more: object = {}) => ({ rel, name: rel.split('/').pop()!, dir: false, gone: false, mtime, vers: 1, ...more });
  const tree = { dir: '/H/보관함', entries: [
    { rel: '자료', name: '자료', dir: true, gone: false, vers: 0 },
    E('자료/시안.png', 30), E('견적서.pdf', 50), E('없어진.md', 90, { gone: true }), E('바로가기.md', 10, { link: '/H/dev/x/원본.md' }),
  ] };
  it('파일만, 최근 것부터, 폴더 자리는 sub 로 — 바로가기는 원본 경로', () => {
    expect(lockerChoices(tree, '')).toEqual([
      { path: '/H/보관함/견적서.pdf', name: '견적서.pdf', folder: '' },
      { path: '/H/보관함/자료/시안.png', name: '시안.png', folder: '자료' },
      { path: '/H/dev/x/원본.md', name: '바로가기.md', folder: '' },
    ]);
  });
  it('친 글자로 거르고 개수를 자른다', () => {
    expect(lockerChoices(tree, '시안').map((x) => x.name)).toEqual(['시안.png']);
    expect(lockerChoices(tree, '', 1).length).toBe(1);
  });
});

describe('mentionRoster — @ 목록에 뜰 참모(띠 순서, 나는 빼고, 쉬는 참모는 뒤에 흐리게)', () => {
  it('살아 있는 참모 먼저 띠 순서 그대로, 쉬는 참모는 off, 지금 채팅 주인은 뺀다', () => {
    const roster = [{ id: 'z9', name: '참모-7', off: true }, { id: 'a1', name: '참모-3 · 가나 담당' }, { id: 'b2', name: '참모-4 · 다라' }];
    const got = mentionRoster(roster, 'b2', (r) => r.name.split(' · ')[1] ?? r.name, (n) => (n.includes('가나') ? '시험 일' : undefined));
    expect(got).toEqual([
      { id: 'a1', name: '참모-3 · 가나 담당', label: '가나 담당', role: '시험 일', off: false },
      { id: 'z9', name: '참모-7', label: '참모-7', role: undefined, off: true },
    ]);
  });
});

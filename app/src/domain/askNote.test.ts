import { describe, expect, it } from 'vitest';
import { askNote, foldNote } from './askNote';

// scripts/task lesson-propose(lesson_skill.py) 가 올리는 물음 모양 — 지어낸 줄
const LESSON = [
  'shop-app 교훈 10줄을 `lesson-cart` 스킬로 묶을까? 지시마다 붙는 글 1,284자 → 196자',
  '언제 열리나: 결제 화면·장바구니를 고치거나 시험할 때',
  '- 장바구니 수량을 0으로 만들면 줄이 남는다',
  '- 쿠폰 적용 API 는 두 번 깎는다',
  '- 주문 내역 캐시는 결제 직후 건너뛴다',
  '- 영수증 메일은 시험 주소만',
  '… 외 6줄',
  '답: 묶어 / 그대로 둬 / 버려(끝난 일·중복) / 다시 묶어',
].join('\n');

describe('물음 글 나누기(askNote)', () => {
  it('첫 줄은 물음, 나머지는 줄 그대로 본문 — 답 줄은 따로', () => {
    const n = askNote(LESSON);
    expect(n.head).toBe('shop-app 교훈 10줄을 `lesson-cart` 스킬로 묶을까? 지시마다 붙는 글 1,284자 → 196자');
    expect(n.body).toEqual([
      '언제 열리나: 결제 화면·장바구니를 고치거나 시험할 때',
      '- 장바구니 수량을 0으로 만들면 줄이 남는다',
      '- 쿠폰 적용 API 는 두 번 깎는다',
      '- 주문 내역 캐시는 결제 직후 건너뛴다',
      '- 영수증 메일은 시험 주소만',
      '… 외 6줄',
    ]);
    expect(n.answerLine).toBe('답: 묶어 / 그대로 둬 / 버려(끝난 일·중복) / 다시 묶어');
  });
  it('답 낱말 — / 로 나누고 괄호 설명은 뺀다', () => {
    expect(askNote(LESSON).answers).toEqual(['묶어', '그대로 둬', '버려', '다시 묶어']);
  });
  it('영어판 Answer: 줄도', () => {
    const n = askNote('Group 10 lessons?\nAnswer: group it / keep as is / discard (done or duplicate) / regroup');
    expect(n.answers).toEqual(['group it', 'keep as is', 'discard', 'regroup']);
    expect(n.body).toEqual([]);
  });
  it('한 줄 물음은 본문·답 없음', () => {
    expect(askNote('웹 머지하고 앱 OTA 같이 갈까?')).toEqual({ head: '웹 머지하고 앱 OTA 같이 갈까?', body: [], answers: [], answerLine: '' });
  });
  it('빈 줄·뒤 공백은 버리고 앞 공백(목록 들여쓰기)은 둔다', () => {
    expect(askNote('\n물음?\n\n  - 하나  \n\n').body).toEqual(['  - 하나']);
  });
  it('답 줄이 아니면(하나뿐·너무 긴 낱말·마지막 줄이 아님) 본문에 남고 알약 없음', () => {
    expect(askNote('물음?\n답: 묶어').answers).toEqual([]);
    expect(askNote('물음?\n답: 묶어').body).toEqual(['답: 묶어']);
    expect(askNote(`물음?\n답: ${'아'.repeat(30)} / 그대로`).answers).toEqual([]);
    const mid = askNote('물음?\n답: 묶어 / 버려\n- 꼬리 줄');
    expect(mid.answers).toEqual([]);
    expect(mid.body).toEqual(['답: 묶어 / 버려', '- 꼬리 줄']);
  });
  it('보기가 7개 넘으면 알약으로 안 만든다', () => {
    expect(askNote('물음?\n답: a / b / c / d / e / f / g').answers).toEqual([]);
  });
  it('첫 줄이 답 줄이면 물음으로 둔다', () => {
    expect(askNote('답: 묶어 / 버려')).toMatchObject({ head: '답: 묶어 / 버려', answers: [] });
  });
});

describe('접을 줄(foldNote)', () => {
  it('접으면 본문 앞 3줄만, 더 있으면 펼침 단추', () => {
    const f = foldNote(askNote(LESSON), false);
    expect(f.body).toEqual(['언제 열리나: 결제 화면·장바구니를 고치거나 시험할 때', '- 장바구니 수량을 0으로 만들면 줄이 남는다', '- 쿠폰 적용 API 는 두 번 깎는다']);
    expect(f.more).toBe(true);
  });
  it('펼치면 전부, 단추는 그대로(접기)', () => {
    const f = foldNote(askNote(LESSON), true);
    expect(f.body).toHaveLength(6);
    expect(f.more).toBe(true);
  });
  it('짧은 물음은 단추 없음', () => {
    expect(foldNote(askNote('웹 머지하고 앱 OTA 같이 갈까?'), false)).toEqual({ body: [], more: false });
    expect(foldNote(askNote('물음?\n- 짧은 줄\n- 또'), false)).toEqual({ body: ['- 짧은 줄', '- 또'], more: false });
  });
  it('줄 수는 적어도 접힌 줄이 한 줄에 안 들어가면(잘림) 단추', () => {
    expect(foldNote(askNote(`물음?\n- ${'긴 줄 '.repeat(10)}`), false).more).toBe(true);
  });
  it('물음 자체가 아주 길면(접힌 물음은 몇 줄로 자른다) 단추', () => {
    expect(foldNote(askNote('가'.repeat(120)), false).more).toBe(true);
  });
});

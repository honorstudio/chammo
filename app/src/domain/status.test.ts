import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { activityStatus, asksUser, docBadges, needsHarness, sessionStatus, statusTone, statusWord, transitions, type ActivityStatus, type ProjectDoc } from './status';

const NOW = Date.parse('2026-09-27T12:00:00Z');
/** 사무실 현황판이 말을 고르는 길(dock) — 책상 status 를 그대로 statusWord 에 */
const officeLike = (st: ActivityStatus) => st;
const at = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe('asksUser — 마지막 답이 사용자에게 묻는 말인가', () => {
  it.each([
    '1번부터 바로 갈까?',
    'pixel_blog_app부터 할까, 아니면 ops-hub부터?',
    '셋 중 하나 골라줘',
    '괜찮으면 머지해줘. 어떻게 할래?',
    '확인해줘',
    '정해줘 ㅇㅇ',
  ])('묻는다: %s', (t) => expect(asksUser(t)).toBe(true));

  it.each(['PR #460 올렸어.', '끝났어. 테스트 전부 통과', '왜 그런지 설명하면? 원인은 A야. 고쳤어.'])('안 묻는다: %s', (t) =>
    expect(asksUser(t)).toBe(false),
  );

  it('질문 뒤에 한마디가 더 붙어도 묻는 걸로 — 실제 acme-shop-g 답(2026-09-27, 놓쳤던 것)', () => {
    const t = [
      'PR-H(#381)을 머지했어. 운영에는 이렇게 나가: ...',
      '진행하려면 두 가지 확인이 필요해:',
      '1. **운영 `send-push` 재배포**(MCP)를 해도 될까? 새 "시술 완료" 이벤트만 추가하고 기존 알림은 그대로야.',
      '2. 배포 후 **실제 발송 테스트**를 해도 될까? 손님1에게 알림과 푸시가 실제로 가.',
      '',
      '둘 다 허락 전에는 하지 않을게. 같은 질문을 참모-2에게도 보내뒀어.',
    ].join('\n');
    expect(asksUser(t)).toBe(true);
  });

  it.each(['승인 필요해 — 머지해도 되면 말해줘', '진행해도 될지 확인 부탁해. 기다릴게.'])('끝이 ? 가 아니어도 허락·확인을 구하면: %s', (t) =>
    expect(asksUser(t)).toBe(true),
  );

  // 2026-10-09 참모 대화 기록 4,621개 턴 끝 답 중 표본을 손으로 매긴 것(놓침 18/60·헛잡음 4/60)을 줄여 옮김
  it.each([
    '레퍼런스 영상 있어? 없으면 내가 찾아올게.',
    '입력 진단 기록, 이제 꺼도 될까? 그리고 1·2번 바로 들어갈까? 참고로 예전 시험 세션이 남겨 둔 개발판이 18시간째 떠 있어서 그건 껐어. 네 앱이랑 세션은 안 건드렸어.',
    '이번 재시작 알림부터 이걸로 보낼까? 진짜 폰 앱 푸시 알림은 따로 크게 만들어야 해서, 나중 일로 남겨 둘게.',
    '네 윈도우 참모한테 이 줄 넣으라고 보낼까? 다른 폴더는 안 건드려.',
  ])('묻는 문장 뒤에 한두 마디가 더 붙어도: %s', (t) => expect(asksUser(t)).toBe(true));

  it.each([
    'A, B, C 중에 어느 방향으로 갈지, 4번 장에 금액을 넣을지 골라 줘.',
    '확대 크기를 종류별로 기억할지 파일별로 기억할지 정해 줘.',
    '"다 진행"이라고 하면 1번부터 순서대로 할게. 빼고 싶은 게 있으면 번호만 말해 줘.',
    '흐름 수정과 크게 보기를 지금 할지, 다음 주에 할지만 정해 주면 바로 맞춰서 진행할게.',
    '갤럭시에서 개발자 옵션 → 무선 디버깅을 켜 주면 바로 붙여서 넘길게.',
    '책상은 세션 수만큼 앞줄부터 채워. "ㄱㄱ" 하면 1번(사무실 뼈대)부터 테스트 먼저 쓰고 만들게.',
    '지금 네가 답할 건 권한 창 자동 허용 하나뿐이야. 참모 쪽에 "ㅇㅇ"만 해주면 돼.',
    '**예시 매장 30곳 같은 묶음 데이터, 지금 안 쓰는 거 맞지?** 맞으면 같은 규칙으로 좁혀서 머지할게.',
    '원래 패키지명을 그대로 쓸지에 대한 답도 기다리고 있어. 내 추천은 그대로 쓰는 거야.',
  ])('띄어 쓴 부탁(골라 줘·정해 줘·켜 주면): %s', (t) => expect(asksUser(t)).toBe(true));

  it.each([
    '배포되면 /admin에서 직접 볼 수 있어. Sentry 정리할지도 아직 네 답 기다리고 있어. 지난 오류 4개는 닫는 거야.',
    '이미 올라간 회차를 다시 캡처할지는 아직 네 답을 기다리고 있어. 애널리틱스는 7·8월이야.',
    '네 답이 필요한 건 세 개야: 1. 인사이트 방향 A/B/C 2. 등급 기준 바꿀지 (추천: 바꾸기) 3. 먼저 확인할 매장 (추천: 첫 번째)',
    '정할 게 세 개 있어 ㅎㅎ 1. PR #397 머지 (추천: 머지) 2. 실패 기록 남기기 (추천: 해) 3. 키 등록은 미뤄도 돼.',
    '1. 다른 방법으로 다시 시도. 2. 이번 한 번만 다른 경로: 네가 허락하면 다른 실행 방식으로 적용해. 급하진 않아.',
  ])('사용자 답을 기다린다고 말하면: %s', (t) => expect(asksUser(t)).toBe(true));

  it.each([
    '이건 고객사 판정 기준을 우리가 바꾸는 거라, 현황표 "고객 확인 필요" 칸에 적어 뒀어. 예시 매장 하나는 왜 목록에 들어 있는지 확인하라고 했어.',
    '확인이 필요했던 4개는 네가 "쓴다"를 골랐어. PR이 올라오면 CI 확인하고 머지할게.',
    '연회비는 보통 US$99야. 결제 직전에 멈추고 다시 물어볼게. 구글 결제 허락과는 별개야.',
    '스캐너 화면을 앞에 두고 클릭해. 그래도 안 되면 "진단"을 눌러서 사진 보내 줘. PR 올라오면 머지할게.',
    '실제 앱에서 ⌘Enter를 직접 눌러보진 않았어. 한 번 눌러보고 안 되면 말해 줘. 공개판 push는 네가 하자고 할 때 다시 뽑을게.',
    '화면에서 "acme-shop 끌까?"처럼 확인 창이 떠. 대화는 남아. 테스트 1059개 통과했어.',
    '고객사도 설정 같은 걸 직접 바꿀 수 있어야 하면 말해 줘.',
    '2. 1번 확인이 끝났다고 내가 알려주면 그 세션이 그때 켜. 단계마다 결과 들어오면 알려 줄게.',
    '재부팅 상황은 여기서 재현하지 못했어. 다음 재부팅 때 최대화해서 확인해 줘. 그래도 붙으면 계속 통해.',
    '그러면 어느 참모든 "내일 일정 뭐야?" 하면 답하고, 일정을 넣으면 달력 화면에 바로 반영돼.',
    '시스템 캐시는 정리 도구로 항목별로 보여 줄 테니 네가 골라 줘. 지금 33GB면 빌드 돌리기엔 충분해.',
    '3. 회신이 오면 내가 세션을 다시 켤게 4. 그때 네가 그 세션에서 /mcp로 한 번만 승인해 줘 그다음에 보호 장치를 다시 적용할게.',
  ])('안 묻는다 — 인용·과거형·딴 뜻의 허락·조건 붙은 부탁·화면 문구: %s', (t) => expect(asksUser(t)).toBe(false));

  it('앞쪽 설명에만 ? 가 있으면 안 묻는다', () => {
    expect(asksUser('왜 느렸을까? 원인은 폴링이었어. 고쳤고 배포까지 끝났어. 다음은 패널 정리야.')).toBe(false);
  });
});

describe('activityStatus — 세션 현황 카드 상태', () => {
  it('busy면 작업 중', () => {
    expect(activityStatus('working', { reply: { ts: at(0), text: '진행 중' } }, NOW)).toBe('working');
  });

  it('CLI가 blocked면 확인창', () => {
    expect(activityStatus('blocked', {}, NOW)).toBe('blocked');
  });

  it('쉬는데 마지막 답이 질문이면 답 필요', () => {
    expect(activityStatus('idle', { prompt: { ts: at(2), text: 'x' }, reply: { ts: at(1), text: '머지할까?' } }, NOW)).toBe('asks');
  });

  it('쉬는데 지시 뒤에 답이 왔고 질문이 아니면 답함(done)', () => {
    expect(activityStatus('idle', { prompt: { ts: at(2), text: 'x' }, reply: { ts: at(1), text: '머지했어' } }, NOW)).toBe('done');
  });

  it('지시가 답보다 나중이면(답을 못 받고 멈춤) 대기', () => {
    expect(activityStatus('idle', { prompt: { ts: at(1), text: 'x' }, reply: { ts: at(2), text: '이전 답' } }, NOW)).toBe('idle');
  });

  it('24시간 넘게 움직임이 없으면 쉼 (질문으로 끝났어도)', () => {
    expect(activityStatus('idle', { reply: { ts: at(30), text: '할까?' } }, NOW)).toBe('stale');
  });

  it('기록이 없으면 대기', () => {
    expect(activityStatus('idle', {}, NOW)).toBe('idle');
  });

  it('로그인이 풀려 멈췄으면 로그인 필요 — 오래됐어도(로그인은 저절로 안 풀린다)', () => {
    const auth = { ts: at(1), text: 'Login expired · Please run /login' };
    expect(activityStatus('idle', { reply: { ts: at(1), text: auth.text }, auth }, NOW)).toBe('login');
    expect(activityStatus('idle', { reply: { ts: at(30), text: auth.text }, auth: { ...auth, ts: at(30) } }, NOW)).toBe('login');
  });

  it('갱신 겹침(retry)은 로그인 필요가 아니다 — 잠깐 뒤 저절로 이어서', () => {
    const auth = { ts: at(1), text: 'Could not refresh your login · Try again in a minute', retry: true as const };
    expect(activityStatus('idle', { reply: { ts: at(1), text: auth.text }, auth }, NOW)).toBe('done');
  });

  it('일하는 중·확인창이면 그쪽이 먼저(로그인 오류 줄이 마지막이어도 지금은 다른 일)', () => {
    const auth = { ts: at(1), text: 'Login expired · Please run /login' };
    expect(activityStatus('working', { auth }, NOW)).toBe('working');
    expect(activityStatus('blocked', { auth }, NOW)).toBe('blocked');
  });

  it('로그인 필요 말·표시', () => {
    expect(statusWord('login')).toBe('로그인 필요');
    expect(statusTone('login')).toBe('ask');
  });
});

describe('transitions — 알림 보낼 변화만 고른다', () => {
  it('작업 중 → 끝남 / 답 필요 / 확인창 은 알린다', () => {
    const prev = { a: 'working', b: 'working', c: 'working' } as const;
    const next = { a: 'done', b: 'asks', c: 'blocked' } as const;
    expect(transitions(prev, next)).toEqual([
      { id: 'a', to: 'done' },
      { id: 'b', to: 'asks' },
      { id: 'c', to: 'blocked' },
    ]);
  });

  it('처음 보는 세션(앱을 막 켬)은 알리지 않는다 — 켜자마자 알림 폭탄 방지', () => {
    expect(transitions({}, { a: 'done' })).toEqual([]);
  });

  it('같은 상태 유지·작업 시작·쉼으로 가는 건 안 알린다', () => {
    expect(transitions({ a: 'done', b: 'idle', c: 'done' }, { a: 'done', b: 'working', c: 'stale' })).toEqual([]);
  });
});

const doc = (o: Partial<ProjectDoc>): ProjectDoc => ({
  name: 'p', hasClaude: true, starterChars: 3000, commitsSinceStarter: 0, lastCommit: '2026-09-26', ...o,
});

describe('docBadges — 사이드바에 작게 붙일 문서 상태', () => {
  it('건강하면 없음', () => expect(docBadges(doc({}))).toEqual([]));
  it('CLAUDE.md 없음', () => expect(docBadges(doc({ hasClaude: false }))).toEqual(['CLAUDE.md 없음']));
  it('starter 가 없으면 배지 없음 — 쓰는 사람만 쓰는 관례라 새 사용자에게 경고로 보이면 안 된다', () => expect(docBadges(doc({ starterChars: null }))).toEqual([]));
  it('8천 자 넘으면 크기를 천 단위로', () => expect(docBadges(doc({ starterChars: 86916 }))).toEqual(['starter 87k']));
  it('starter 갱신 뒤 커밋 10개 이상이면 밀림', () => expect(docBadges(doc({ commitsSinceStarter: 84 }))).toEqual(['starter 84커밋 밀림']));
  it('여러 개면 다 붙인다', () =>
    expect(docBadges(doc({ hasClaude: false, starterChars: 12000, commitsSinceStarter: 10 }))).toEqual(['CLAUDE.md 없음', 'starter 12k', 'starter 10커밋 밀림']));
});

describe('영어 모드', () => {
  afterEach(() => setLang('ko'));
  it('문서 상태 뱃지를 영어로', () => {
    setLang('en');
    expect(docBadges(doc({ hasClaude: false, starterChars: null }))).toEqual(['no CLAUDE.md']);
    expect(docBadges(doc({ commitsSinceStarter: 12 }))).toEqual(['starter 12 commits behind']);
  });
});

describe('needsHarness — 프로젝트 화면에 "하네스 깔기" 버튼을 띄울까', () => {
  it('CLAUDE.md 나 starter 가 없으면 띄운다', () => {
    expect(needsHarness(doc({ hasClaude: false }))).toBe(true);
    expect(needsHarness(doc({ starterChars: null }))).toBe(true);
  });
  it('둘 다 있으면 안 띄운다', () => expect(needsHarness(doc({}))).toBe(false));
  it('모르면(스캔 전) 안 띄운다', () => expect(needsHarness(undefined)).toBe(false));
});

describe('상태 말 하나로 — 메뉴·대시보드·사무실이 같은 판단(오피스 A 1단계, 2026-10-04)', () => {
  it('같은 세션이면 메뉴(statusOf)와 사무실(현황판)이 같은 상태 — 답이 질문꼴이 아니면 답함(예전 메뉴는 awaiting 으로 물어봄)', () => {
    const st = activityStatus('idle', { prompt: { ts: at(2), text: 'x' }, reply: { ts: at(1), text: '로그인 화면까지 갔어' } }, NOW);
    expect(statusWord(st)).toBe('답함');
    expect(statusWord(officeLike(st))).toBe('답함');
  });
  it('대화 기록 없이 세션만으로 — 메뉴가 기록을 아직 못 읽었을 때', () => {
    expect(sessionStatus({ state: 'working' })).toBe('working');
    expect(sessionStatus({ state: 'idle', awaiting: true } as never)).toBe('idle'); // awaiting = 턴 끝난 대부분 — 묻는다는 뜻 아님
    expect(sessionStatus({ state: 'blocked' })).toBe('blocked');
    expect(sessionStatus({ state: 'idle' })).toBe('idle');
  });
  it('말은 한 표 — 같은 상태면 어디서나 같은 말', () => {
    expect(['working', 'asks', 'blocked', 'done', 'idle', 'stale'].map((x) => statusWord(x as never))).toEqual(['일하는 중', '물어봄', '기다림', '답함', '쉼', '잠듦']);
  });
  it('표시 색 갈래 — 일함(도는 고리)·물음(노란 점)·나머지(없음)', () => {
    expect(statusTone('working')).toBe('run');
    expect(statusTone('asks')).toBe('ask');
    expect(statusTone('blocked')).toBe('ask');
    expect(statusTone('done')).toBe('idle');
  });
  it('영어', () => {
    setLang('en');
    expect(statusWord('asks')).toBe('Asking');
    expect(statusWord('done')).toBe('Replied');
    setLang('ko');
  });
});

// 답하고 다음 지시를 기다리는 살아 있는 세션이 '끝남'이라 꺼진 세션(끔·끝남 줄)과 구별이 안 됐다(2026-10-04 QA N4)
describe('statusWord — 살아 있는 세션의 말은 꺼진 세션 말과 겹치지 않는다', () => {
  it("답을 끝낸(done) 세션은 '답함' — '끝남'은 꺼진 세션 줄에만", () => {
    expect(statusWord('done')).toBe('답함');
    expect((['working', 'asks', 'blocked', 'done', 'idle', 'stale'] as const).map(statusWord)).not.toContain('끝남');
  });
});

import { describe, expect, it } from 'vitest';
import { avatarClasses, avatarKey, BRAND, baseVoice, bodyColor, checkSize, defaultVoice, helloLine, voiceFor, VOICES, avatarState, checkUpload, defaultAvatar, jitter, orchColor, ORCH_COLORS, parseEntries, resolveAvatar, SHAPES, transitionOf, validKey } from './avatar';

describe('avatarKey — 프사는 별명 앞 기본 이름에 붙는다(참모-2 · 별명으로 바뀌어도 그대로)', () => {
  it('별명을 떼고 앞뒤 공백을 지운다', () => {
    expect(avatarKey('참모-2 · 참모 업데이트')).toBe('참모-2');
    expect(avatarKey('참모-2')).toBe('참모-2');
    expect(avatarKey('  참모 ')).toBe('참모');
  });
  it('별명이 바뀌어도 같은 키', () => {
    expect(avatarKey('참모-3 · 디자인')).toBe(avatarKey('참모-3 · 개발'));
  });
  it('조합형(NFD)으로 와도 같은 키 — 맥 파일 이름은 NFD 로 돌아올 수 있다', () => {
    expect(avatarKey('참모-2'.normalize('NFD'))).toBe('참모-2');
  });
  it('이름이 비면 기본 이름', () => {
    expect(avatarKey('')).toBe('참모');
  });
});

describe('validKey — Rust safe_key 와 같은 규칙(저장 전 미리 막기)', () => {
  it('글자·숫자·-·_·띄어쓰기만, 64자까지', () => {
    expect(validKey('참모-2')).toBe(true);
    expect(validKey('Chammo 3')).toBe(true);
    for (const k of ['CON', 'nul', 'com1', '', '../x', 'a/b', 'a.b', 'a:b', '가'.repeat(65)]) expect(validKey(k)).toBe(false);
  });
});

describe('기본 도형 — 참모 번호로 도형을 고르게 돌린다', () => {
  it('참모=1번째, 참모-2=2번째 …, 한 바퀴 돌면 처음부터', () => {
    expect(defaultAvatar('참모').shape).toBe(SHAPES[0]);
    expect(defaultAvatar('참모-2').shape).toBe(SHAPES[1]);
    expect(defaultAvatar(`참모-${SHAPES.length + 1}`).shape).toBe(SHAPES[0]);
  });
  it('번호 없는 이름(설정 이름을 바꾼 첫 참모 — 참모 등)도 1번째', () => {
    expect(defaultAvatar('참모').shape).toBe(SHAPES[0]);
    expect(defaultAvatar('참모-2').shape).toBe(SHAPES[1]);
  });
  it('첫 참모 = 앱 대표 캐릭터(파란 모찌, 앱 아이콘과 같다), 참모-2 = 주황 동그라미(2026-10-03 사용자)', () => {
    expect(BRAND).toEqual({ shape: 'mochi', eyes: 'pill', color: '#2f74e0' });
    expect(defaultAvatar('참모')).toMatchObject({ shape: BRAND.shape, eyes: BRAND.eyes });
    expect(orchColor('참모')).toBe(BRAND.color);
    expect(defaultAvatar('참모-2').shape).toBe('circle');
    expect(orchColor('참모-2')).toBe('#d9622b');
  });
  it('눈은 흰 알약, 색은 순서 색(null)', () => {
    expect(defaultAvatar('참모-5')).toMatchObject({ kind: 'preset', eyes: 'pill', color: null });
  });
});

describe('parseEntries — Rust 가 준 목록을 다시 거른다', () => {
  it('목록에 없는 도형·눈, 이상한 색은 버리거나 비운다', () => {
    const got = parseEntries([
      { key: '참모', avatar: { kind: 'preset', shape: 'mochi', eyes: 'dark', color: '#2f74e0' }, v: 1 },
      { key: '참모-2', avatar: { kind: 'preset', shape: 'banana', eyes: 'pill' }, v: 1 },
      { key: '참모-3', avatar: { kind: 'preset', shape: 'star', eyes: 'pill', color: 'red;x' }, v: 1 },
      { key: '참모-4', avatar: { kind: 'image', file: '참모-4.gif', crop: { zoom: 1.4, x: 0, y: 0.2 } }, v: 9 },
      { key: '참모-5', avatar: { kind: 'image', file: '../x.gif', crop: { zoom: 1, x: 0, y: 0 } }, v: 9 },
      null, 'x',
    ]);
    expect([...got.keys()]).toEqual(['참모', '참모-3', '참모-4']);
    expect(got.get('참모-3')).toMatchObject({ avatar: { color: null } });
  });
});

describe('resolveAvatar — 저장한 게 있으면 그것, 없으면 기본형', () => {
  it('없으면 번호 도형', () => {
    expect(resolveAvatar(new Map(), '참모-2 · 별명')).toMatchObject({ kind: 'preset', shape: SHAPES[1] });
  });
  it('별명이 붙어도 저장한 프사를 찾는다', () => {
    const m = parseEntries([{ key: '참모-2', avatar: { kind: 'preset', shape: 'cloud', eyes: 'pupil' }, v: 1 }]);
    expect(resolveAvatar(m, '참모-2 · 참모 업데이트')).toMatchObject({ shape: 'cloud', eyes: 'pupil' });
  });
});

describe('avatarState — 앱이 아는 세션 상태 → 프사 상태', () => {
  it('일함·물음·쉼·꺼짐', () => {
    expect(avatarState({ state: 'working' })).toBe('work');
    expect(avatarState({ state: 'blocked' })).toBe('ask');
    expect(avatarState({ state: 'idle' })).toBe('rest');
    expect(avatarState(undefined)).toBe('off');
  });
  it('CLI awaiting(턴 끝남)은 묻는 얼굴이 아니다 — 상태 말(statusWord)과 같은 판단(2026-10-04 오피스 A 남은 것 ①)', () => {
    const ended = { state: 'idle' as const, awaiting: true }; // 앱 Session 모양 그대로(awaiting 은 넘어와도 안 본다)
    expect(avatarState(ended)).toBe('rest');
  });
  it('상태(ActivityStatus)를 주면 그 한 표로 — 묻는 답·기다림·로그인은 묻는 얼굴, 답함·잠듦은 쉼', () => {
    expect(avatarState({ state: 'idle' }, 'asks')).toBe('ask');
    expect(avatarState({ state: 'idle' }, 'login')).toBe('ask');
    expect(avatarState({ state: 'blocked' }, 'blocked')).toBe('ask');
    expect(avatarState({ state: 'idle' }, 'done')).toBe('rest');
    expect(avatarState({ state: 'idle' }, 'stale')).toBe('rest');
    expect(avatarState({ state: 'working' }, 'working')).toBe('work');
    expect(avatarState(undefined, 'asks')).toBe('off');
  });
});

describe('transitionOf — 상태가 바뀔 때 한 번 하는 동작(시안 v2 확정 표)', () => {
  it.each([
    ['rest', 'off', 'sleep'], ['work', 'off', 'sleep'],
    ['off', 'rest', 'wake'], ['off', 'work', 'wake'], ['rest', 'work', 'wake'], ['ask', 'work', 'wake'],
    ['rest', 'ask', 'alert'], ['work', 'ask', 'alert'],
    ['ask', 'rest', 'calm'],
    ['work', 'rest', 'joy'],
  ] as const)('%s → %s = %s', (from, to, tr) => {
    expect(transitionOf(from, to)).toBe(tr);
  });
  it('그대로면 없음', () => {
    expect(transitionOf('rest', 'rest')).toBeNull();
  });
});

describe('jitter — 참모마다 시작 시점·박자를 흩뜨린다(±12%)', () => {
  it('같은 키는 늘 같은 값, 범위 안', () => {
    const a = jitter('참모-2');
    expect(jitter('참모-2')).toEqual(a);
    for (const k of ['참모', '참모-2', '참모-3', '아이맥', 'x']) {
      const j = jitter(k);
      expect(j.k).toBeGreaterThanOrEqual(0.88);
      expect(j.k).toBeLessThanOrEqual(1.12);
      expect(j.delay).toBeLessThanOrEqual(0);
      expect(j.delay).toBeGreaterThan(-9);
    }
  });
  it('이웃 참모끼리 다르다', () => {
    expect(jitter('참모-2')).not.toEqual(jitter('참모-3'));
  });
});

describe('orchColor — 참모 색은 이름 번호로 고정(사이드바·채팅 탭·폰이 같은 색)', () => {
  it('재현: 다른 참모가 꺼져도 색이 안 바뀐다(2026-10-03 사용자 "왜 너 색이 바뀌었냐") — 순서가 아니라 번호', () => {
    expect(orchColor('참모-2 · 참모 업데이트')).toBe(ORCH_COLORS[1]);
    expect(orchColor('참모-2')).toBe(ORCH_COLORS[1]);
  });
  it('번호 없는 첫 참모는 첫 색, 모자라면 다시 처음부터', () => {
    expect(orchColor('참모')).toBe(ORCH_COLORS[0]);
    expect(orchColor('참모 · 개발')).toBe(ORCH_COLORS[0]);
    expect(orchColor(`참모-${ORCH_COLORS.length + 1}`)).toBe(ORCH_COLORS[0]);
    expect(orchColor('')).toBe(ORCH_COLORS[0]);
  });
  it('도형(defaultAvatar)과 같은 번호를 쓴다 — 별명의 숫자는 안 센다', () => {
    expect(orchColor('참모-3 · 2팀')).toBe(ORCH_COLORS[2]);
  });
});

describe('checkUpload — 올리기 전 미리 거르기(진짜 검사는 Rust 가 첫 바이트로)', () => {
  it('형식·크기', () => {
    expect(checkUpload({ type: 'image/gif', size: 1000 })).toBeNull();
    expect(checkUpload({ type: 'image/webp', size: 5 * 1024 * 1024 })).toBeNull();
    expect(checkUpload({ type: 'image/svg+xml', size: 10 })).not.toBeNull();
    expect(checkUpload({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).not.toBeNull();
    expect(checkUpload({ type: 'image/png', size: 0 })).not.toBeNull();
  });
});

describe('avatarClasses — 상태·전환이 CSS 클래스로(전역 .running·.done 과 안 겹치게 oa- 접두)', () => {
  it('도형 · 일함 · 전환 없음 · 22px', () => {
    expect(avatarClasses({ image: false, state: 'work', transition: null, size: 22 })).toBe('oa oa-st-work');
  });
  it('그림 · 물음 · 부름 전환 · 16px', () => {
    expect(avatarClasses({ image: true, state: 'ask', transition: 'alert', size: 16 })).toBe('oa oa-img oa-st-ask oa-tr-alert oa-s16');
  });
  it('모든 클래스가 oa- 로 시작', () => {
    for (const c of avatarClasses({ image: true, state: 'off', transition: 'sleep', size: 18 }).split(' ')) expect(c.startsWith('oa')).toBe(true);
  });
});

describe('bodyColor — 채팅 칸 색도 프사에서 고른 색을 따른다', () => {
  it('고른 색 > 순서 색, 그림 프사는 순서 색', () => {
    const m = parseEntries([
      { key: '참모-2', avatar: { kind: 'preset', shape: 'cloud', eyes: 'pill', color: '#9b51e0' }, v: 1 },
      { key: '참모-3', avatar: { kind: 'image', file: '참모-3.png', crop: { zoom: 1, x: 0, y: 0 } }, v: 1 },
    ]);
    expect(bodyColor(m, '참모-2 · 별명', '#2f74e0')).toBe('#9b51e0');
    expect(bodyColor(m, '참모-3', '#1f9a62')).toBe('#1f9a62');
    expect(bodyColor(m, '참모-9', '#d9622b')).toBe('#d9622b');
  });
});

describe('checkSize — 큰 그림(압축 폭탄) 막기', () => {
  it('4096px 까지', () => {
    expect(checkSize(4096, 300)).toBeNull();
    expect(checkSize(4097, 300)).not.toBeNull();
    expect(checkSize(0, 0)).not.toBeNull();
  });
});

describe('avatarClasses tone — 참모 색 면 위(고른 탭 알약)에선 몸·눈을 뒤집는다', () => {
  it('onColor 면 oa-oncolor', () => {
    expect(avatarClasses({ image: false, state: 'rest', transition: null, size: 18, tone: 'onColor' })).toBe('oa oa-st-rest oa-s16 oa-oncolor');
    expect(avatarClasses({ image: false, state: 'rest', transition: null, size: 18 })).toBe('oa oa-st-rest oa-s16');
  });
});

describe('참모 목소리 — 프로필의 voice(2026-10-02 사용자 "오케마다 목소리 다르게")', () => {
  it('설정 음성 명령에서 기본 목소리 — 앱의 Supertonic 실행기일 때만', () => {
    expect(baseVoice('~/.chammo/tts/supertonic/speak -v F2')).toBe('F2');
    expect(baseVoice('/Users/me/.honor-orchestrator/tts/supertonic/speak')).toBe('M1');
    expect(baseVoice('say -v Yuna')).toBeUndefined();
    expect(baseVoice('~/bin/local-say')).toBeUndefined(); // 거기선 -v 가 OpenAI
    expect(baseVoice('~/.chammo/tts/supertonic/speak -v X9')).toBe('M1'); // 이상한 값이면 M1
  });
  it('기본 배정 — 설정 목소리가 첫 참모, 번호마다 남·여 번갈아 서로 다르게', () => {
    expect(defaultVoice('참모', 'M1')).toBe('M1');
    expect(defaultVoice('참모-2', 'M1')).toBe('F1');
    expect(defaultVoice('참모-3', 'M1')).toBe('M2');
    expect(defaultVoice('참모', 'F3')).toBe('F3');
    expect(defaultVoice('참모-2', 'F3')).toBe('M4');
    const ten = Array.from({ length: 10 }, (_, i) => defaultVoice(`참모-${i + 1}`, 'M1'));
    expect(new Set(ten).size).toBe(10);
    expect(defaultVoice('참모-11', 'M1')).toBe('M1'); // 열 개 넘으면 다시 처음부터
  });
  it('저장한 목소리가 먼저, 별명이 붙어도 같은 참모', () => {
    const m = parseEntries([{ key: '참모-2', avatar: { kind: 'preset', shape: 'cloud', eyes: 'pill', voice: 'F5' }, v: 1 }]);
    expect(voiceFor(m, '참모-2 · 참모 업데이트', 'M1')).toBe('F5');
    expect(voiceFor(m, '참모-3', 'M1')).toBe('M2');
  });
  it('허용 목록 밖 목소리는 버린다(그 참모는 기본 배정)', () => {
    const m = parseEntries([{ key: '참모-2', avatar: { kind: 'preset', shape: 'cloud', eyes: 'pill', voice: 'M1; rm -rf ~' }, v: 1 }]);
    expect(m.get('참모-2')!.avatar.voice ?? null).toBeNull();
    expect(voiceFor(m, '참모-2', 'M1')).toBe('F1');
    expect(VOICES).toHaveLength(10);
  });
});

describe('helloLine — 들어 보기 문장', () => {
  it('받침 있으면 이야, 없으면 야', () => {
    expect(helloLine('개발 담당')).toBe('안녕, 나는 개발 담당이야');
    expect(helloLine('참모 업데이트')).toBe('안녕, 나는 참모 업데이트야');
    expect(helloLine(' 참모 ')).toBe('안녕, 나는 참모야');
    expect(helloLine('Chammo')).toBe('안녕, 나는 Chammo야');
    expect(helloLine('참모-7')).toBe('안녕, 나는 참모-7이야'); // 칠
    expect(helloLine('참모-2')).toBe('안녕, 나는 참모-2야'); // 이
  });
});

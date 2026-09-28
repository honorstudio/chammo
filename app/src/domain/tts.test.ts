import { describe, expect, it } from 'vitest';
import { nativeVoices, readTts, ttsCommand } from './tts';

const RUNNER = '~/.chammo/tts/supertonic/speak';

describe('readTts — 저장된 음성 명령을 설정 화면의 선택으로', () => {
  it('비었거나 say 면 macOS 기본 목소리', () => {
    expect(readTts('', RUNNER)).toEqual({ engine: 'native', voice: '', command: '' });
    expect(readTts('say', RUNNER)).toEqual({ engine: 'native', voice: '', command: 'say' });
  });

  it('say -v 이름 이면 그 macOS 목소리', () => {
    expect(readTts('say -v Yuna', RUNNER)).toEqual({ engine: 'native', voice: 'Yuna', command: 'say -v Yuna' });
  });

  it('Supertonic 실행기면 Supertonic, 목소리 없으면 M1', () => {
    expect(readTts(`${RUNNER} -v F2`, RUNNER)).toEqual({ engine: 'supertonic', voice: 'F2', command: `${RUNNER} -v F2` });
    expect(readTts(RUNNER, RUNNER).voice).toBe('M1');
  });

  it('그 밖의 명령은 직접 입력(예전 설정·개인 스크립트는 그대로 둔다)', () => {
    expect(readTts('~/bin/local-say', RUNNER)).toEqual({ engine: 'custom', voice: '', command: '~/bin/local-say' });
    expect(readTts('say -v Yuna -r 200', RUNNER).engine).toBe('custom');
  });
});

describe('ttsCommand — 선택을 저장할 음성 명령으로', () => {
  it('macOS 목소리', () => {
    expect(ttsCommand({ engine: 'native', voice: '', command: '' }, RUNNER)).toBe('say');
    expect(ttsCommand({ engine: 'native', voice: 'Eddy', command: '' }, RUNNER)).toBe('say -v Eddy');
  });

  it('Supertonic', () => {
    expect(ttsCommand({ engine: 'supertonic', voice: 'M3', command: '' }, RUNNER)).toBe(`${RUNNER} -v M3`);
    expect(ttsCommand({ engine: 'supertonic', voice: '', command: '' }, RUNNER)).toBe(`${RUNNER} -v M1`);
  });

  it('직접 입력은 적은 그대로', () => {
    expect(ttsCommand({ engine: 'custom', voice: '', command: '~/bin/local-say' }, RUNNER)).toBe('~/bin/local-say');
  });
});

describe('nativeVoices — `say -v ?` 목록에서 그 언어 목소리 이름만', () => {
  const LIST = [
    'Albert              en_US    # Hello! My name is Albert.',
    'Eddy (한국어(한국))      ko_KR    # 안녕하세요. 제 이름은 Eddy입니다.',
    'Yuna                ko_KR    # 안녕하세요. 제 이름은 유나입니다.',
    'Yuna (한국어(한국))      ko_KR    # 안녕하세요. 제 이름은 유나입니다.',
    'Eddy (English (US))     en_US    # Hello! My name is Eddy.',
  ].join('\n');

  it('한국어: 짧은 이름(say -v 에 그대로 쓰는 것), 겹치면 하나', () => {
    expect(nativeVoices(LIST, 'ko')).toEqual(['Eddy', 'Yuna']);
  });

  it('영어', () => {
    expect(nativeVoices(LIST, 'en')).toEqual(['Albert', 'Eddy']);
  });
});

import { describe, expect, it } from 'vitest';
import { fieldKey } from './typeField';

const k = (o: Partial<{ key: string; keyCode: number; isComposing: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }>) =>
  ({ key: 'a', keyCode: 65, isComposing: false, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o });

describe('숨은 글칸 키 나누기', () => {
  it('조합을 끝내는 WebKit Enter(229·조합 끝남)는 버리지 않고 마지막 글자 뒤로 미룬다', () => {
    expect(fieldKey(k({ key: 'Enter', keyCode: 229 }), '유튜브')).toBe('defer');
    expect(fieldKey(k({ key: 'Enter', keyCode: 229, isComposing: true }), '유튜브')).toBe('ignore');
  });
  it('입력기 몫(229·조합 중)은 손대지 않는다', () => {
    expect(fieldKey(k({ key: 'Process', keyCode: 229 }), '')).toBe('ignore');
    expect(fieldKey(k({ key: 'ㅂ', keyCode: 81, isComposing: true }), '')).toBe('ignore');
  });
  it('글칸에 글이 있으면 Backspace 는 글칸이(macOS 26 입력기가 앞 자모로 다시 묶는다), 비었으면 키로', () => {
    expect(fieldKey(k({ key: 'Backspace', keyCode: 8 }), '유튜')).toBe('native');
    expect(fieldKey(k({ key: 'Backspace', keyCode: 8 }), '')).toBe('key');
    expect(fieldKey(k({ key: 'Backspace', keyCode: 8, metaKey: true }), '유튜')).toBe('key');
  });
  it('Enter·화살표', () => {
    expect(fieldKey(k({ key: 'Enter', keyCode: 13 }), 'abc')).toBe('enter');
    expect(fieldKey(k({ key: 'Enter', keyCode: 13, shiftKey: true }), 'abc')).toBe('key');
    expect(fieldKey(k({ key: 'ArrowLeft', keyCode: 37 }), 'abc')).toBe('key');
  });
});

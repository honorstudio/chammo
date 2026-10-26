// 허용 카드 열기 응답 — Rust e2e_cmd::card_open_json 과 같은 계약 파일을 읽는다(10-25 QA)
import { describe, expect, it } from 'vitest';
import contract from './e2eCardOpen.contract.json';
import { parseCardOpen } from './e2eNumber';

describe('허용 카드 열기 계약', () => {
  it('Rust 가 내는 모양을 그대로 읽는다 — mode·4자리', () => {
    expect(parseCardOpen(contract.click)).toEqual({ mode: 'click', code: '' });
    expect(parseCardOpen(contract.code)).toEqual({ mode: 'code', code: '0420' });
  });
  it('모르는 모양(글자·빈 값)은 누르기가 아니라 기다림 — 열쇠 있는 기기에 누르기를 띄우지 않게', () => {
    expect(parseCardOpen('number').mode).toBe('wait');
    expect(parseCardOpen(null).mode).toBe('wait');
    expect(parseCardOpen({ mode: 'wait' }).mode).toBe('wait');
    expect(parseCardOpen({ mode: 'number' }).mode).toBe('number');
  });
});

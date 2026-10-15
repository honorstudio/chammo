import { describe, expect, it } from 'vitest';
import { formatCell } from './sheetFormat';

describe('엑셀 숫자 서식 → 보이는 글(폰 표)', () => {
  it('일반·소수·콤마·원', () => {
    expect(formatCell(1234)).toBe('1234');
    expect(formatCell(0.1 + 0.2)).toBe('0.3');
    expect(formatCell(3944666.6666666665, '#,##0')).toBe('3,944,667');
    expect(formatCell(1234.5, '#,##0.00')).toBe('1,234.50');
    expect(formatCell(60000, '#,##0"원"')).toBe('60,000원');
    expect(formatCell(-60000, '#,##0"원"')).toBe('-60,000원');
    expect(formatCell(5, '0.0')).toBe('5.0');
  });
  it('퍼센트·양수;음수 두 칸·색 표시는 뺀다', () => {
    expect(formatCell(0.256, '0%')).toBe('26%');
    expect(formatCell(0.256, '0.0%')).toBe('25.6%');
    expect(formatCell(-1500, '#,##0;[Red](#,##0)')).toBe('(1,500)');
    expect(formatCell(1500, '#,##0;[Red](#,##0)')).toBe('1,500');
  });
  it('날짜·시각(1900 일련번호)', () => {
    expect(formatCell(46112, 'yyyy-mm-dd')).toBe('2026-03-31');
    expect(formatCell(46112, 'yyyy"년" m"월" d"일"')).toBe('2026년 3월 31일');
    expect(formatCell(46112.75, 'yyyy-mm-dd hh:mm')).toBe('2026-03-31 18:00');
    expect(formatCell(0.5, 'h:mm AM/PM')).toBe('12:00 PM');
  });
  it('글·참거짓·빈 칸', () => {
    expect(formatCell('1월', '#,##0')).toBe('1월');
    expect(formatCell(true)).toBe('TRUE');
    expect(formatCell(null, '#,##0')).toBe('');
  });
});

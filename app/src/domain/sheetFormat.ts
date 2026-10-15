/**
 * 엑셀 숫자 서식 → 보이는 글 — 폰 읽기 전용 표가 쓴다(맥은 표 라이브러리가 그린다).
 * 흔한 것만: 일반·0·0.00·#,##0·%·지수 없이·앞뒤 따옴표 글("원")·날짜/시각(yyyy mm dd hh mm ss)·양수;음수 두 칸. 모르는 건 숫자 그대로
 */
import type { SheetValue } from './sheetBook';

/** 엑셀 날짜 일련번호(1900 체계) → 날짜 */
function serialDate(n: number): Date {
  // 1900-02-29(없는 날)을 엑셀이 센다 — 60 이후는 하루 당긴다
  const days = n >= 60 ? n - 1 : n;
  const ms = Math.round((days - 1) * 86400000);
  return new Date(Date.UTC(1900, 0, 1) + ms);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function formatDate(n: number, code: string): string {
  const d = serialDate(Math.floor(n));
  const secs = Math.round((n - Math.floor(n)) * 86400);
  const [h, mi, s] = [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60];
  const ampm = /AM\/PM/i.test(code);
  // m 이 분인지 월인지 — h 뒤나 s 앞이면 분
  return code.replace(/AM\/PM|yyyy|yy|mm|m|dd|d|hh|h|ss|s|"[^"]*"|\\./gi, (t, i: number) => {
    const low = t.toLowerCase();
    if (t.startsWith('"')) return t.slice(1, -1);
    if (t.startsWith('\\')) return t.slice(1);
    if (low === 'am/pm') return h < 12 ? 'AM' : 'PM';
    if (low === 'yyyy') return String(d.getUTCFullYear());
    if (low === 'yy') return pad(d.getUTCFullYear() % 100);
    if (low === 'dd') return pad(d.getUTCDate());
    if (low === 'd') return String(d.getUTCDate());
    const hh = ampm ? (h % 12 || 12) : h;
    if (low === 'hh') return pad(hh);
    if (low === 'h') return String(hh);
    if (low === 'ss') return pad(s);
    if (low === 's') return String(s);
    const before = code.slice(0, i).replace(/"[^"]*"/g, '');
    const after = code.slice(i + t.length).replace(/"[^"]*"/g, '');
    const minute = /h[^dmy]*$/i.test(before) || /^[^dmy]*s/i.test(after);
    if (minute) return low === 'mm' ? pad(mi) : String(mi);
    return low === 'mm' ? pad(d.getUTCMonth() + 1) : String(d.getUTCMonth() + 1);
  });
}

function formatNumber(n: number, code: string): string {
  const pct = code.includes('%');
  const x = pct ? n * 100 : n;
  // 따옴표 글·\ 글자는 그대로, 숫자 자리 모양만 본다
  const shape = code.replace(/"[^"]*"|\\./g, '');
  const dec = (shape.split('.')[1]?.match(/[0#]/g) ?? []).length;
  const grouping = /#,##|0,0/.test(shape);
  const abs = Math.abs(x);
  let body = abs.toFixed(dec);
  if (grouping) { const [i, f] = body.split('.'); body = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : ''); }
  let done = false;
  return code.replace(/"([^"]*)"|\\(.)|[#0,.]+%?|%|\[[^\]]*\]|_.|\*./g, (t, q?: string, esc?: string) => {
    if (q !== undefined) return q;
    if (esc !== undefined) return esc;
    if (t.startsWith('[') || t.startsWith('_') || t.startsWith('*')) return ''; // 색·자리 맞춤·채우기
    if (t === '%') return '%';
    if (done) return '';
    done = true;
    return body + (t.endsWith('%') ? '%' : '');
  });
}

/** 칸 값 + 숫자 서식 → 보이는 글 */
export function formatCell(v: SheetValue | undefined | null, code?: string): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') {
    // 글 칸의 '@' 서식·글 섹션(;;;"…"@)은 글 그대로
    return v;
  }
  if (!code || /^general$/i.test(code)) {
    if (Number.isInteger(v)) return String(v);
    return String(Number(v.toPrecision(11)));
  }
  const parts = code.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const sec = v < 0 && parts[1] !== undefined ? parts[1] : v === 0 && parts[2] !== undefined ? parts[2] : parts[0]!;
  const val = v < 0 && parts[1] !== undefined ? -v : v;
  const bare = sec.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  if (/[ymdhs]/i.test(bare) && !/[0#]/.test(bare)) return formatDate(val, sec.replace(/\[[^\]]*\]/g, ''));
  if (!/[0#]/.test(bare)) return sec.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1') || String(v);
  const out = formatNumber(val, sec);
  return v < 0 && parts[1] === undefined ? `-${out}` : out;
}

// 폰 짝짓기 — QR 주소의 일회용 코드(?pair=) 읽기. 토큰은 쿠키가 아니라 localStorage(출처 = 스킴+호스트+포트)에 둔다(data/web.ts)
const CODE = /^[0-9a-f]{32}$/;

/** location.search → 짝짓기 코드(16진 32자) 또는 null */
export function pairCodeFrom(search: string): string | null {
  const c = new URLSearchParams(search).get('pair');
  return c && CODE.test(c) ? c : null;
}

/** 붙여 넣은 글 → 연결 코드. 코드 그대로·4자 묶음(띄어 씀)·대문자·연결 주소(?pair=) 다 받는다. 모양이 다르면 null */
export function codeFromText(text: string): string | null {
  const t = text.trim();
  const q = t.indexOf('?');
  if (q >= 0) return pairCodeFrom(t.slice(q));
  const c = t.replace(/[\s-]/g, '').toLowerCase();
  return CODE.test(c) ? c : null;
}

/** 화면에 읽기 좋게 4자씩 띄운다(복사는 원래 코드로) */
export const groupCode = (c: string) => c.replace(/(.{4})(?=.)/g, '$1 ');

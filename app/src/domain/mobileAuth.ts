// 폰 짝짓기 — QR 주소의 일회용 코드(?pair=) 읽기. 토큰은 쿠키가 아니라 localStorage(출처 = 스킴+호스트+포트)에 둔다(data/web.ts)
const CODE = /^[0-9a-f]{32}$/;

/** location.search → 짝짓기 코드(16진 32자) 또는 null */
export function pairCodeFrom(search: string): string | null {
  const c = new URLSearchParams(search).get('pair');
  return c && CODE.test(c) ? c : null;
}

/** location.search → 홈 화면 앱 넘기기 코드(?home=, 모양은 QR 코드와 같다) 또는 null */
export function homeCodeFrom(search: string): string | null {
  const c = new URLSearchParams(search).get('home');
  return c && CODE.test(c) ? c : null;
}

/** 넘기기 주소 — 사파리가 QR 로 짝지은 뒤 이 주소로 한 번 다시 연다 */
export const homeUrl = (code: string) => `/?home=${code}`;

/** 켤 때 짝짓기 — null 이면 그냥 화면. handoff = 끝나면 홈 화면 앱 넘기기 코드를 받아 homeUrl 로 다시 연다.
 *  아이폰 홈 화면 앱은 사파리와 저장소가 따로라 사파리 열쇠를 못 본다. 그리고 '홈 화면에 추가'는 페이지를 처음 읽은 주소를
 *  시작 주소로 굳힌다(뒤에 replaceState·manifest 바꿔 끼우기는 안 먹음 — 2026-10-16 시뮬레이터 실측). 그래서 사파리는 1회용 코드를 든 주소로
 *  한 번 다시 열어 두고, 홈 화면 앱은 첫 켜기에 그 코드로 짝짓는다. 시작 주소는 켤 때마다 같으니 열쇠가 있거나 맥이 한 번 거절한 코드(spentBy)는 다시 안 낸다
 *  (지난 코드를 켤 때마다 내면 맥의 틀린 횟수가 쌓여 살아 있는 코드까지 죽는다) */
export function bootPair({ search, standalone, hasToken, tried }: { search: string; standalone: boolean; hasToken: boolean; tried: string | null }): { code: string; home: boolean; handoff: boolean } | null {
  const qr = pairCodeFrom(search);
  if (!standalone) return qr ? { code: qr, home: false, handoff: true } : null;
  const code = homeCodeFrom(search) ?? qr;
  if (!code || hasToken || code === tried) return null;
  return { code, home: true, handoff: false };
}

/** 짝짓기 실패가 그 코드를 쓴 것인가 — 맥이 답한(거절한) 때만. fetch 망 오류(TypeError — 테일스케일 꺼짐 등)는 코드가 아직 살아 있을 수 있어
 *  다음 켜기에 다시 낸다(bootPair tried) */
export const spentBy = (e: unknown) => !(e instanceof TypeError);

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

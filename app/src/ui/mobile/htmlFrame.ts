// html 파일 보기(시안 등) — 같은 출처로 그리면 그 안 스크립트가 폰의 기기 토큰(localStorage)과 /api 에 닿으니,
// sandbox 로 출처를 불투명하게 둔다. allow-same-origin 은 절대 넣지 않는다(넣으면 sandbox 가 무력해진다).
// 시안은 표 주소(/api/html-ticket)로 열고 서버가 자기 CSP(sandbox allow-scripts)를 달아 스크립트가 돈다 — srcdoc 은 폰 CSP 를 물려받아 막혔다
export const HTML_SANDBOX = 'allow-scripts';

/** 시안 칸 모양. 중계 길(입구 주소 + 서비스 워커)에선 sandbox 속성이 붙은 칸 요청을 워커가 못 받아 입구 망으로 가서 404(흰 화면, 2026-11-01 —
 *  크롬·WebKit 둘 다). 그 길에선 속성 없이 서버 응답 CSP(sandbox allow-scripts)로만 가둔다(출처 null 그대로, proxy.ts frameSafe 가 그 CSP 없는 답은 막는다).
 *  칸 안 그림 요청도 워커를 못 타니 서버가 같은 폴더 그림을 품어(?inline=1) 한 번에 준다 */
export function htmlFrame(url: string, relay: boolean): { src: string; sandbox?: string } {
  if (!relay) return { src: url, sandbox: HTML_SANDBOX };
  return { src: `${url}${url.includes('?') ? '&' : '?'}inline=1` };
}

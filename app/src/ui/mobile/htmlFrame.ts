// html 파일 보기(시안 등) — 같은 출처로 그리면 그 안 스크립트가 폰의 기기 토큰(localStorage)과 /api 에 닿으니,
// sandbox 로 출처를 불투명하게 둔다. allow-same-origin 은 절대 넣지 않는다(넣으면 sandbox 가 무력해진다).
// 시안은 표 주소(/api/html-ticket)로 열고 서버가 자기 CSP(sandbox allow-scripts)를 달아 스크립트가 돈다 — srcdoc 은 폰 CSP 를 물려받아 막혔다
export const HTML_SANDBOX = 'allow-scripts';

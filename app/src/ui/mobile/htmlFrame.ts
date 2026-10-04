// html 파일 보기(시안 등) — 보기 전용. 같은 출처로 그리면 그 안 스크립트가 폰의 기기 토큰(localStorage)과 /api 에 닿으니,
// srcdoc + sandbox 로 출처를 불투명하게 둔다. allow-same-origin 은 절대 넣지 않는다(넣으면 sandbox 가 무력해진다).
// 폰 화면 CSP 를 srcdoc 이 물려받아 인라인 스크립트·바깥 글꼴은 막힌다 — 모양만 보이고 표시(쓴다·뺀다)는 맥에서
export const HTML_SANDBOX = 'allow-scripts';

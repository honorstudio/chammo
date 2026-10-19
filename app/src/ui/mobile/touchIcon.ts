// 홈 화면 앱 아이콘을 html 안에(data:) — 아이폰 '홈 화면에 추가'가 맥에서 그림을 200 으로 받아 가고도 '참' 글자 아이콘을 만들었다
// (2026-10-16 사용자 실기: 공유 시트 NetworkingExtension 은 받았고, 추가 시트 SafariViewService 요청은 맥에 하나도 안 닿음).
// 시뮬레이터는 같은 서버 조건(루트 404·manifest text/html·https·다크)으로 재현이 안 됐고, 아이콘 요청을 전부 막아도 data: 면 프사가 떴다 —
// 그림을 망에서 받을 일을 없앤다. 빌드 때 vite.config 가 mobile.html 에만 적용(원본 html 은 /assets 경로 그대로)
export const TOUCH_ICON_HREF = '/assets/apple-touch-icon.png';

/** html 의 apple-touch-icon 경로 → data:image/png;base64. 그 줄이 없으면 그대로 */
export function inlineTouchIcon(html: string, png: Uint8Array): string {
  const b64 = Buffer.from(png).toString('base64');
  return html.replace(`rel="apple-touch-icon" href="${TOUCH_ICON_HREF}"`, `rel="apple-touch-icon" href="data:image/png;base64,${b64}"`);
}

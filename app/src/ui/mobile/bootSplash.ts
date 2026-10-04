// 첫 그림(mobile.html 의 #boot-splash) — JS 가 오기 전부터 보이는 파란 모찌. 앱이 첫 화면을 받으면(또는 짝짓기·못 닿음 화면이면) 걷는다(150ms 페이드)
export function hideBootSplash(): void {
  const el = typeof document === 'undefined' ? null : document.getElementById('boot-splash');
  if (!el || el.classList.contains('out')) return;
  el.classList.add('out');
  window.setTimeout(() => el.remove(), 170);
}

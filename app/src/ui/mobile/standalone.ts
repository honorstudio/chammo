// 홈 화면에 붙인 앱으로 열렸나 — iOS 는 navigator.standalone, 그 밖은 display-mode
export const isStandalone = () => {
  if (typeof window === 'undefined') return false;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
};

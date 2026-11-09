// 설정을 마칠 때 — 설정 화면과 첫 설치가 같이 쓴다
import type { Config } from '../data/tauri';

export const reloadApp = () => {
  try { sessionStorage.removeItem('mirrorReloaded'); } catch { /* 없어도 된다 */ }
  location.reload();
};

/** 언어·비서 이름을 main.tsx 가 다음에 뜰 때 읽는 자리에 */
export function mirrorConfig(c: Config) {
  try {
    if (c.language === 'ko' || c.language === 'en') localStorage.setItem('lang', c.language);
    if (c.assistantName.trim()) localStorage.setItem('assistantName', c.assistantName.trim());
    else localStorage.removeItem('assistantName');
  } catch { /* 저장소가 막혀도 설정 파일이 있으니 다음에 App 이 다시 비춘다 */ }
}

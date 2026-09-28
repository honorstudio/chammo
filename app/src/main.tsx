import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/styles.css';
import { installFileDrop } from './ui/fileDrop';

// 언어·비서 이름은 App 을 불러오기 **전에** 정한다 — 모듈 맨 위의 표(가챠 이름 등)가 tr() 로 된 채 평가되기 때문.
// 설정(config.json)의 값을 localStorage 에 비춰 둔 것을 읽는다(동기). 설정에서 바꾸면 창을 다시 연다
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));

// 터미널에 파일 끌어다 놓기 — Rust 가 window.__drop 으로 넘긴다
installFileDrop();

// 터미널 폰트를 먼저 불러온 뒤 그린다 (xterm 은 처음 열 때 칸 폭을 잰다). 실패해도 1.5초 뒤엔 그린다
const fonts = Promise.all([
  document.fonts.load('12px "Chammo Hangul"', '가'),
  document.fonts.load('12px "MesloLGSDZ Nerd Font Mono"', 'a'),
]);
Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).finally(async () => {
  const { default: App } = await import('./App');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

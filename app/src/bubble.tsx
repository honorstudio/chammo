import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/layers.css';
import './ui/styles.css';

// 바탕 배지 창(bubble.html, Rust orch_bubble) — 앱을 내려도 배지만 바탕 위에. 언어·비서 이름은 화면 모듈을 불러오기 전에(widget.tsx 와 같은 이유)
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));
document.documentElement.classList.add('obd-root');

void import('./ui/space/DeskBubble').then(({ DeskBubble }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <DeskBubble />
    </StrictMode>,
  );
});

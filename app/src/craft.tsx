import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/layers.css';
import './ui/styles.css';

// Craft 맥 앱 따로 창(craft.html?app=<앱>) — 언어·비서 이름은 화면 모듈을 불러오기 전에(mode.tsx 와 같은 이유)
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));

const app = new URLSearchParams(location.search).get('app') ?? '';
void import('./ui/craft/CraftWin').then(({ CraftWin }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <CraftWin app={app} />
    </StrictMode>,
  );
});

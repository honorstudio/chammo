import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/layers.css';
import './ui/styles.css';

// 메신저 따로 창(messenger.html?c=all|<방>, Rust team_window) — 언어·비서 이름은 화면 모듈을 불러오기 전에(craft.tsx 와 같은 이유)
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));

const c = new URLSearchParams(location.search).get('c') ?? 'all';
void import('./ui/team/MessengerApp').then(({ MessengerApp }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MessengerApp win={c} />
    </StrictMode>,
  );
});

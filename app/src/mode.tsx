import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/layers.css';
import './ui/styles.css';
import './ui/paused.css';
import { bindAttention } from './ui/attention';
import { installModeBus } from './ui/mode/modeBus';

// 참모 모드 따로 창(mode.html?m=<이름>) — 언어·비서 이름은 화면 모듈을 불러오기 전에(reader.tsx 와 같은 이유)
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));

document.body.classList.add('mode-win');
const name = new URLSearchParams(location.search).get('m') ?? '';

installModeBus();
// 안 보면 무한 애니메이션 멈춤(ui/paused.css) — 이 창엔 프사가 없을 수 있어 직접 붙인다
bindAttention();
void import('./ui/mode/ModeWin').then(({ ModeWin }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ModeWin name={name} />
    </StrictMode>,
  );
});

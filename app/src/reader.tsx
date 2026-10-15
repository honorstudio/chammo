import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/layers.css';
import './ui/reader/reader.css';
import './ui/paused.css';
import { bindAttention } from './ui/attention';

// 언어·비서 이름은 화면 모듈을 불러오기 **전에** 정한다(main.tsx 와 같은 이유 — 모듈 맨 위 표가 tr() 로 평가된다)
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));

document.body.classList.add('reader-win');
// 안 보면 무한 애니메이션 멈춤(ui/paused.css) — 이 창엔 프사가 없을 수 있어 직접 붙인다
bindAttention();

void Promise.all([import('./ui/reader/Reader'), import('./ui/ErrorBoundary')]).then(([{ ReaderWindow }, { ErrorBoundary }]) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <ReaderWindow />
      </ErrorBoundary>
    </StrictMode>,
  );
});

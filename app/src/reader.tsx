import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/reader/reader.css';

// 언어·비서 이름은 화면 모듈을 불러오기 **전에** 정한다(main.tsx 와 같은 이유 — 모듈 맨 위 표가 tr() 로 평가된다)
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));

document.body.classList.add('reader-win');

void import('./ui/reader/Reader').then(({ ReaderWindow }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ReaderWindow />
    </StrictMode>,
  );
});

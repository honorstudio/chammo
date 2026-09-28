import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/styles.css';
import './ui/tama/more.css';

// 다마고치 "더보기" 창 — 도감·보관함을 다마고치 기기 색(LCD 연두/검정 초록) 틀에 담아 따로 띄운다
// (사용자 2026-09-28: 위젯에서 더보기를 누르면 메인 창 페이지가 바뀌는 게 어색하다)
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));

void import('./ui/tama/TamaMore').then(({ TamaMore }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TamaMore />
    </StrictMode>,
  );
});

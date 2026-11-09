import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/webBeat';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/layers.css';
import './ui/styles.css';
import './ui/space/space.css';

// 내 메모 따로 창(notes.html, Rust notes_window) — 언어·비서 이름은 화면 모듈을 불러오기 전에(craft.tsx 와 같은 이유)
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));

// ⌘A — 앱 메뉴 항목이라 Rust 가 이 창이 앞이면 __menu('select_all') 를 부른다(main.rs route_menu)
(window as unknown as { __menu?: (id: string) => void }).__menu = (id) => { if (id === 'select_all') void import('./ui/selectAll').then((m) => m.selectAllHere(false, null)); };

void import('./ui/notes/NotesWin').then(({ NotesWin }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <NotesWin />
    </StrictMode>,
  );
});

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pickLang, setAssistant, setLang } from './i18n';
import './ui/layers.css';
import './ui/styles.css';
import { bumpUsage } from './data/tauri';

// 메신저 따로 창(messenger.html?c=all&r=<방>, Rust team_window) — 언어·비서 이름은 화면 모듈을 불러오기 전에(craft.tsx 와 같은 이유)
const saved = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
setLang(pickLang(saved('lang'), navigator.language));
setAssistant(saved('assistantName'));

const q = new URLSearchParams(location.search);
const c = q.get('c') ?? 'all';
// 이 창에 놓은 파일은 대화 칸으로(Rust drop.rs 가 team-* 창이면 그 창에 넘긴다) — fileDrop 의 다른 칸(터미널·문서)은 이 창에 없다
void import('./ui/team/teamDrop').then(({ teamDrop }) => { (window as unknown as { __drop?: (e: Parameters<typeof teamDrop>[0]) => void }).__drop = (e) => void teamDrop(e); });
// ⌘A — 앱 메뉴 항목이라 Rust 가 이 창이 앞이면 __menu('select_all') 를 부른다(main.rs route_menu). 메인 창과 같은 규칙: 보고 있는 칸(입력칸·보관함)만
(window as unknown as { __menu?: (id: string) => void }).__menu = (id) => { if (id === 'select_all') void import('./ui/selectAll').then((m) => m.selectAllHere(false, null)); };
// 입력칸 쓰던 글(<데이터>/drafts.json)을 먼저 읽고 그린다
void import('./data/drafts').then((d) => d.loadDrafts()).catch(() => {}).then(() => import('./ui/team/MessengerApp')).then(({ MessengerApp }) => {
  bumpUsage('messenger'); // 익명 사용 통계 — 창을 연 횟수만
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MessengerApp win={c} room={q.get('r') ?? ''} />
    </StrictMode>,
  );
});

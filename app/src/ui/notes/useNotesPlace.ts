// 내 메모가 어디 떠 있나 — 스페이스 패널 / 따로 창. 채팅 뷰는 패널이 기본(창으로 뺐으면 창), 터미널 뷰엔 스페이스가 없어 바로 창(시안 memo-panel C)
import { useCallback, useEffect, useState } from 'react';
import { NOTES_CHANGED, notesToggle } from '../../domain/notes';
import { notesList, notesWindowOpen } from '../../data/tauri';

const KEY = 'myNotes.panel';
const saved = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const save = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 이번 실행만 */ } };

export function useNotesPlace(chatView: boolean) {
  const [panel, setPanelState] = useState(saved);
  const [win, setWin] = useState(false);
  const setPanel = useCallback((on: boolean) => { setPanelState(on); save(on); }, []);
  const openWin = useCallback(() => { setWin(true); void notesWindowOpen().catch(() => setWin(false)); }, []);
  // 따로 창이 닫히면 Rust 가 부른다 — dock = '패널로 되돌리기', left = 남은 메모 창 수(메모마다 창 하나, 시안 v2 W)
  useEffect(() => {
    const w = window as unknown as { __notesClosed?: (a: { dock: boolean; left: number }) => void };
    w.__notesClosed = ({ dock, left }) => {
      if (!left) setWin(false);
      if (dock) setPanel(true);
      window.dispatchEvent(new Event(NOTES_CHANGED)); // 패널이 띄운 / 안 띄운 목록을 다시 읽는다
    };
    return () => { delete w.__notesClosed; };
  }, [setPanel]);
  // 앱을 켜면 따로 창에 띄워 둔 메모를 제자리(기억한 자리)에 다시 띄운다 — 맥 스티커 메모처럼(시안 v2 W)
  useEffect(() => {
    void notesList().then((rs) => {
      const ws = rs.filter((r) => r.shown && r.win);
      if (!ws.length) return;
      setWin(true);
      for (const r of ws) void notesWindowOpen(r.name).catch(() => {});
    }).catch(() => {});
  }, []);
  const toggle = () => {
    const to = notesToggle(chatView, panel, win);
    if (to === 'window') openWin();
    else setPanel(to === 'panel');
  };
  const toWindow = () => { setPanel(false); openWin(); };
  return { panel: panel && chatView && !win, on: win || (panel && chatView), toggle, closePanel: () => setPanel(false), toWindow };
}

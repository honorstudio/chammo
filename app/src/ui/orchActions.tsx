// 참모 끄기·지우기·이름 바꾸기 — 채팅 탭·메뉴·대시보드 어디서든 같은 창(2026-09-30 사용자)
import { createContext, useCallback, useContext, useState } from 'react';
import type { Session } from '../domain/session';
import { assistant, tr } from '../i18n';
import { ContextMenu, Confirm, Rename } from './OrchDialogs';
import { orchLabel, setOrchLabel, useOrchLabels } from './orchLabels';

type MenuItem = { label: string; danger?: boolean; run: () => void };
type Ctx = {
  /** label: 창에 보일 이름(프로젝트 세션은 프로젝트·작업공간 이름) — 없으면 별명·설정 이름 */
  askStop: (s: Session, label?: string) => void;
  askRename: (s: Session) => void;
  /** 오른쪽 클릭 메뉴(이름 바꾸기·세션 끄기·세션 지우기) */
  menu: (e: React.MouseEvent, s: Session) => void;
  /** 아무 항목으로나 오른쪽 클릭 메뉴(꺼진 참모 등) */
  openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  /** 확인 받고 지우기(꺼진 세션 등) — 제목·본문·실행 */
  confirm: (c: { title: string; body: string; ok: string; run: () => void }) => void;
  /** 보일 이름 — 별명, 없으면 설정 이름 */
  nameOf: (s: Session) => string;
};
const C = createContext<Ctx | null>(null);
export const useOrchActions = () => useContext(C);

export function OrchActionsProvider({ onStop, onRemove, children }: { onStop: (s: Session) => void; onRemove: (id: string) => void; children: React.ReactNode }) {
  useOrchLabels(); // 별명이 바뀌면 다시 그린다
  const [ask, setAsk] = useState<{ title: string; body: string; ok: string; run: () => void } | null>(null);
  const [rename, setRename] = useState<Session | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const nameOf = useCallback((s: Session) => orchLabel(s.id) ?? (s.name || assistant()), []);
  const askStop = (s: Session, label?: string) => setAsk({
    title: tr(`${label ?? nameOf(s)} 끌까?`, `Stop ${label ?? nameOf(s)}?`),
    body: tr('대화는 남아서 나중에 "꺼진 세션"에서 이어서 켤 수 있어. 하던 일은 멈춰.', 'The conversation is kept — you can resume it later. Work in progress stops.'),
    ok: tr('끄기', 'Stop'), run: () => onStop(s),
  });
  const askRemove = (s: Session) => setAsk({
    title: tr(`${nameOf(s)} 지울까?`, `Remove ${nameOf(s)}?`),
    body: tr('세션을 끄고 목록에서도 빼. "꺼진 세션"에도 안 남아(대화 기록 파일은 남아).', 'Stops it and removes it from the list — it won\'t show under stopped sessions (the transcript file stays).'),
    ok: tr('지우기', 'Remove'), run: () => onRemove(s.id),
  });
  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items }); };
  const ctx: Ctx = {
    askStop,
    askRename: setRename,
    menu: (e, s) => openMenu(e, [
      { label: tr('이름 바꾸기', 'Rename'), run: () => setRename(s) },
      { label: tr('세션 끄기', 'Stop session'), danger: true, run: () => askStop(s) },
      { label: tr('세션 지우기(끄고 목록에서 빼기)', 'Remove session (stop and delist)'), danger: true, run: () => askRemove(s) },
    ]),
    openMenu,
    confirm: setAsk,
    nameOf,
  };
  return (
    <C.Provider value={ctx}>
      {children}
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menu.items} />}
      {ask && <Confirm title={ask.title} body={ask.body} ok={ask.ok} danger onCancel={() => setAsk(null)} onOk={() => { ask.run(); setAsk(null); }} />}
      {rename && <Rename current={orchLabel(rename.id) ?? ''} fallback={rename.name || assistant()}
        onCancel={() => setRename(null)} onSave={(v) => { setOrchLabel(rename.id, v); setRename(null); }} />}
    </C.Provider>
  );
}

/** 참모 이름(별명, 없으면 설정 이름) — 두 번 누르기·오른쪽 클릭으로 바꾸는 건 부르는 쪽에서 */
export function OrchName({ s, className }: { s: Session; className?: string }) {
  const a = useOrchActions();
  return <span className={className}>{a ? a.nameOf(s) : s.name || assistant()}</span>;
}

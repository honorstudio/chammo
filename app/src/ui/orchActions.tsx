// 참모 끄기·지우기·이름 바꾸기 — 채팅 탭·메뉴·대시보드 어디서든 같은 창(2026-09-30 사용자)
import { createContext, useCallback, useContext, useState } from 'react';
import type { Session } from '../domain/session';
import { assistant, tr } from '../i18n';
import { ContextMenu, Confirm, Rename } from './OrchDialogs';
import { orchDisplay, orchLabel, setOrchLabel, useOrchLabels } from './orchLabels';
import { displayName, splitOrchName, withNick, renameTo } from '../domain/orchLabel';
import { sendTextToSession } from '../data/tauri';
import { AvatarPicker } from './avatar/AvatarPicker';
import { orchestratorLike } from '../domain/session';
import { orchRoleSet, saveOrchRole } from './orchRoleStore';

type MenuItem = { label: string; danger?: boolean; run: () => void };
type Ctx = {
  /** label: 창에 보일 이름(프로젝트 세션은 프로젝트·작업공간 이름) — 없으면 별명·설정 이름 */
  /** why = 누른 길(actions.log) — 메뉴·카드·⌘W 확인 창 */
  askStop: (s: Session, label?: string, why?: string) => void;
  askRename: (s: Session) => void;
  /** 프사 바꾸기 창 — color = 저장한 색이 없을 때 쓰는 참모 순서 색 */
  askAvatar: (s: Session, color: string) => void;
  /** 오른쪽 클릭 메뉴(이름 바꾸기·프사 바꾸기·세션 끄기·세션 지우기) */
  menu: (e: React.MouseEvent, s: Session, color?: string) => void;
  /** 아무 항목으로나 오른쪽 클릭 메뉴(꺼진 참모 등) */
  openMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  /** 확인 받고 지우기(꺼진 세션 등) — 제목·본문·실행 */
  /** danger = 빨간 위험 버튼(기본). 추가·설치처럼 되돌리기 쉬운 건 false */
  confirm: (c: { title: string; body: string; ok: string; run: () => void; danger?: boolean }) => void;
  /** 보일 이름 — 별명, 없으면 설정 이름 */
  nameOf: (s: Session) => string;
};
const C = createContext<Ctx | null>(null);
export const useOrchActions = () => useContext(C);

/** 앱 별명을 진짜 세션 이름에도 — /rename "참모-3 · 별명". 별명이 앱에만 있으면 세션끼리 주고받는 메시지엔 참모-3 만 찍혀
 *  서로 누가 누군지 몰랐다(2026-10-02 사용자). 세션 기록에 이름이 바뀐 줄이 남아 그 세션도 자기 이름을 안다 */
export function syncRealName(s: Session, label: string | undefined) {
  const to = label === undefined ? null : withNick(s.name || assistant(), label);
  if (!to || to === s.name) return;
  void sendTextToSession(s.id, `/rename ${to}`).catch(() => {});
}

/** pins·onPin = 참모 고정(폰과 같은 orch-pins.json) — 참모 줄 메뉴 맨 위 '고정'·'고정 풀기' */
/** onNick = 별명을 바꿨을 때 진짜 이름(/rename)은 App 이 쉬는 때 보낸다(일하는 중·첫 턴에 보내면 턴 끝에 되돌아갔다). 없으면 바로 보낸다 */
export function OrchActionsProvider({ pins = [], onPin, onNick, onStop, onRemove, children }: { pins?: string[]; onPin?: (s: Session, on: boolean) => void; onNick?: (s: Session, nick: string) => void; onStop: (s: Session, why: string) => void; onRemove: (id: string) => void; children: React.ReactNode }) {
  useOrchLabels(); // 별명이 바뀌면 다시 그린다
  const [ask, setAsk] = useState<{ title: string; body: string; ok: string; run: () => void; danger?: boolean } | null>(null);
  const [rename, setRename] = useState<Session | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [avatar, setAvatar] = useState<{ s: Session; color: string } | null>(null);
  const nameOf = useCallback((s: Session) => orchDisplay(s) || assistant(), []);
  const askStop = (s: Session, label?: string, why = 'confirm') => setAsk({
    title: tr(`${label ?? nameOf(s)} 끌까?`, `Stop ${label ?? nameOf(s)}?`),
    body: tr('대화는 남아서 나중에 "꺼진 세션"에서 이어서 켤 수 있어. 하던 일은 멈춰.', 'The conversation is kept — you can resume it later. Work in progress stops.'),
    ok: tr('끄기', 'Stop'), run: () => onStop(s, why),
  });
  const askRemove = (s: Session) => setAsk({
    title: tr(`${nameOf(s)} 지울까?`, `Remove ${nameOf(s)}?`),
    body: tr('세션을 끄고 목록에서도 빼. "꺼진 세션"에도 안 남아(대화 기록 파일은 남아).', 'Stops it and removes it from the list — it won\'t show under stopped sessions (the transcript file stays).'),
    ok: tr('지우기', 'Remove'), run: () => onRemove(s.id),
  });
  // 이름 바꾸기 — 이름 창·프로필 창이 같은 길(앱 별명 + 쉬는 때 /rename)
  const saveNick = (s: Session, v: string) => { setOrchLabel(s.id, v); if (onNick) onNick(s, v); else syncRealName(s, v); };
  const nickProps = (s: Session) => ({ current: orchLabel(s.id) ?? splitOrchName(s.name).nick ?? '', fallback: displayName(splitOrchName(s.name).base) || assistant() });
  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items }); };
  const ctx: Ctx = {
    askStop,
    askRename: setRename,
    askAvatar: (s, color) => setAvatar({ s, color }),
    menu: (e, s, color) => openMenu(e, [
      // 고정 — 참모만(색을 넘기는 줄), 대화 id 가 있을 때
      ...(color && onPin && s.sessionId ? [pins.includes(s.sessionId)
        ? { label: tr('고정 풀기', 'Unpin'), run: () => onPin(s, false) }
        : { label: tr('맨 위에 고정', 'Pin to top'), run: () => onPin(s, true) }] : []),
      { label: color ? tr('이름·맡은 일', 'Name & role') : tr('이름 바꾸기', 'Rename'), run: () => setRename(s) },
      ...(color ? [{ label: tr('프로필 바꾸기', 'Change avatar'), run: () => setAvatar({ s, color }) }] : []), // 참모만(도우미 줄은 색을 안 넘긴다)
      { label: tr('세션 끄기', 'Stop session'), danger: true, run: () => askStop(s, undefined, 'menu') },
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
      {ask && <Confirm title={ask.title} body={ask.body} ok={ask.ok} danger={ask.danger !== false} onCancel={() => setAsk(null)} onOk={() => { ask.run(); setAsk(null); }} />}
      {avatar && <AvatarPicker name={avatar.s.name || ''} label={nameOf(avatar.s)} color={avatar.color} nick={{ ...nickProps(avatar.s), onSave: (v) => saveNick(avatar.s, v) }} onClose={() => setAvatar(null)} />}
      {rename && <Rename {...nickProps(rename)}
        role={orchestratorLike(rename.name) ? orchRoleSet(rename.name) : undefined /* 맡은 일은 참모만(이름과 따로, 2026-10-04) */}
        onCancel={() => setRename(null)} onSave={(v, role) => {
          saveNick(rename, v);
          if (role !== undefined && role.trim() !== orchRoleSet(rename.name).trim()) void saveOrchRole(rename.name, role).catch(() => {});
          setRename(null);
        }} />}
    </C.Provider>
  );
}

/** 참모 이름(별명, 없으면 설정 이름) — 두 번 누르기·오른쪽 클릭으로 바꾸는 건 부르는 쪽에서 */
export function OrchName({ s, className }: { s: Session; className?: string }) {
  const a = useOrchActions();
  return <span className={className}>{a ? a.nameOf(s) : orchDisplay(s) || assistant()}</span>;
}



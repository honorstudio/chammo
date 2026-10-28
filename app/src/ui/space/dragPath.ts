// 스페이스 것(파일 카드·파일/폴더·문서·세션·참모)을 채팅 입력창으로 끌어다 놓기(2026-09-30 사용자).
// 웹 끌기(HTML5 drag)는 앱 창의 파일 끌어다 놓기(Tauri)가 가로채서 안 됐다 — 마우스를 직접 따라간다.
// 조금(5px) 움직이기 전엔 그냥 클릭이다
import { invoke } from '@tauri-apps/api/core';
import { tr } from '../../i18n';
import { attachToChat } from '../fileDrop';
import { LOCKER_MOVE } from './useLocker';
import { chatDropAt, lightChat } from './chatDrop';
import { lostRelease } from './dragEnd';
import { dirOfId, TEAM_LOCKER_DROP, TEAM_LOCKER_MOVE, TEAM_LOCKER_OUT } from '../../domain/teamLocker';
import { TEAM_DROP_EVENT } from '../team/teamDrop';
import { ORCH_DROPPED } from '../../domain/orchBubble';
import { TEAM_GIVE_IN } from '../../domain/teamGive';

export const PATH_MIME = 'text/x-chammo-path'; // 옛 웹 끌기(남은 곳 호환)

/** paths = 보관함에서 여럿 고른 채 그중 하나를 끈 묶음(2026-10-12) · team = 팀 보관함 파일(id — 풀기 전엔 경로가 없다, 10-26) */
export type DragPayload = { kind: 'path'; path: string } | { kind: 'paths'; paths: string[] } | { kind: 'text'; text: string } | { kind: 'team'; team: string; ids: string[] };

/** 채팅 입력칸에 글을 넣는 신호 — ChatView 가 받는다 */
export const CHAT_INSERT = 'chat-insert';

/** 놓을 채팅 세션 — 채팅 칸(머리·대화 기록·입력칸·카드 여백) 어디든(chatDrop, 2026-10-12 사용자) */
const chatAt = (x: number, y: number): string | null => chatDropAt(x, y)?.id ?? null;

/** 보관함 폴더 자리(카드를 끌어 놓으면 그 폴더로) — 참모 보관함 [data-locker-folder] · 팀 보관함 칩 [data-team-folder] */
const LOCKER_FOLDER = '[data-locker-folder]';
const TEAM_FOLDER = '[data-team-folder]';
/** 팀 보관함 파일을 놓는 자리 — 폴더 칩·띠 참모 프사(그 참모에게, 10-26 사용자)·팀 대화 칸(그 대화에 첨부) */
const TEAM_SPOTS = '[data-team-folder], [data-orch-drop], .tmx-convo[data-team-drop]';
const isConvo = (el: HTMLElement | null) => !!el?.matches('.tmx-convo[data-team-drop]');
/** 참모 보관함 파일(경로)을 놓는 팀 보관함 자리 — 폴더 칩(그 폴더에)·팀 보관함 칸(지금 고른 폴더에, 10-28 사용자 "끌어도 반응 없음") */
const TEAM_IN = '[data-team-folder], [data-team-id]';
function folderAt(x: number, y: number, sel = LOCKER_FOLDER): HTMLElement | null {
  return (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(sel) ?? null;
}

/** 끄는 것 자신이나 그 안 폴더인가 — 거기엔 빛도 놓기도 없다(파인더처럼, 10-28 사용자). 이름만 앞이 같은 형제(자료2)는 아니다 */
export function selfOrInside(dragged: string[], target: string): boolean {
  return dragged.some((p) => target === p || target.startsWith(`${p}/`));
}
/** 끄는 것의 자리 — 참모 보관함은 절대 경로(놓는 자리 data-locker-path 와 견준다), 팀 보관함은 폴더 키(dir:견적 → 견적, data-team-folder 와) */
const selfOf = (p: DragPayload): string[] =>
  p.kind === 'path' ? [p.path] : p.kind === 'paths' ? p.paths : p.kind === 'team' ? p.ids.map(dirOfId).filter((k): k is string => k !== null) : [];
/** 그 놓는 자리가 끄는 것 자신·그 안인가 — 경로(/로 시작)는 참모 보관함 data-locker-path, 팀 폴더 키는 data-team-folder 와 견준다 */
function selfSpot(el: HTMLElement | null, self: string[]): boolean {
  if (!el || !self.length) return false;
  const at = self[0]!.startsWith('/') ? el.dataset.lockerPath : el.dataset.teamFolder;
  return at !== undefined && selfOrInside(self, at);
}

/** 대화 파일 보기 칸 — 참모 보관함 파일을 놓으면 팀 전체에 올라가 버려서 안 받는다(TeamLocker 가 놓을 때 같은 이유를 말한다) */
const ROOM_VIEW = '.tlk-room';
const ROOM_WHY = () => tr('대화 파일 보기엔 못 올려요 — 팀 보관함 탭이나 위 폴더 칩에 놓아 줘', 'Not here — drop on the team locker tab or a folder chip above');
const NOT_HERE = () => tr('여기엔 못 놓아요 — 팀 보관함 칸이나 폴더 칩에 놓아 줘', "Can't drop here — use the team locker or a folder chip");
/** 다른 창의 팀 파일을 놓는 자리 — 띠 참모 얼굴(채팅 칸은 chatDropAt) · 못 놓은 자리면 보낸 창에 한 줄 */
const ORCH_SPOT = '[data-orch-drop]';
const TEAM_MISS = () => tr('참모에게 주려면 참모 얼굴이나 참모 채팅 칸에 놓아 줘', 'To give it to an assistant, drop it on their face or chat');

/** 이름 표 자리 — 커서 오른쪽 아래, 창 끝에 닿으면 창 안으로 당긴다(아래 끝이면 커서 위로). 이유 줄이 붙으면 표가 커서 잘렸다 */
export function ghostAt(x: number, y: number, w = 0, h = 0, vw = window.innerWidth, vh = window.innerHeight): [number, number] {
  const gx = typeof vw === 'number' && w ? Math.max(4, Math.min(x + 12, vw - w - 8)) : x + 12;
  const gy = typeof vh === 'number' && h && y + 10 + h > vh - 8 ? Math.max(4, y - h - 10) : y + 10;
  return [gx, gy];
}

/** 끌기 유령 표 + 놓을 채팅 칸 빛(칸 전체) — 스페이스 것 끌기와 띠 프사 끌기(@멘션 넣기)가 같이 쓴다. 놓으면 그 채팅 칸 세션(없으면 null).
 *  folders = 빛낼 폴더 자리(true = 참모 보관함, 글 = 그 선택자) · remote = 다른 창에서 끌고 있는 것(놓을 자리가 아니면 이유를 단다)
 *  self = 끄는 것 자신(selfOf) — 그 폴더·그 안 폴더는 빛내지 않는다 */
export function dragGhost(label: string, folders: boolean | string, remote = false, self: string[] = []) {
  const fsel = typeof folders === 'string' ? folders : LOCKER_FOLDER;
  let ghost: HTMLDivElement | null = null;
  let hot: HTMLElement | null = null;
  // 팀 대화 칸은 자기 '여기 놓으면 붙여요' 판을 쓴다(파인더 끌기와 같은 신호)
  const light = (el: HTMLElement | null) => {
    if (hot === el) return;
    if (isConvo(hot)) hot!.dispatchEvent(new CustomEvent(TEAM_DROP_EVENT, { detail: { over: false } }));
    else hot?.classList.remove('drop-hot');
    if (isConvo(el)) el!.dispatchEvent(new CustomEvent(TEAM_DROP_EVENT, { detail: { over: true } }));
    else el?.classList.add('drop-hot');
    hot = el;
  };
  // 놓을 자리와 못 받는 이유 — 참모 보관함 파일(folders === true)은 팀 보관함 칩·칸, 참모 보관함 폴더
  const spotAt = (x: number, y: number): { spot: HTMLElement | null; why: string | null } => {
    if (!folders) return { spot: null, why: null };
    if (fsel !== LOCKER_FOLDER) return { spot: folderAt(x, y, fsel), why: null };
    const team = folderAt(x, y, TEAM_IN);
    if (team && team.dataset.teamFolder === undefined && team.closest(ROOM_VIEW)) return { spot: null, why: ROOM_WHY() };
    return { spot: team ?? folderAt(x, y, fsel), why: null };
  };
  return {
    get on() { return !!ghost; },
    move(x: number, y: number) {
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'cv-drag-ghost';
        ghost.textContent = label;
        document.body.appendChild(ghost);
        document.documentElement.classList.add('cv-dragging');
      }
      // 채팅 칸 위면 칸 전체(카드) 강조, 아니면 보관함 폴더 줄 — 못 받는 자리면 강조 대신 표에 이유 한 줄
      const chat = chatDropAt(x, y);
      lightChat(chat);
      const { spot, why } = chat ? { spot: null, why: null } : spotAt(x, y);
      light(selfSpot(spot, self) ? null : spot);
      const no = why ?? (remote && !chat && !spot ? NOT_HERE() : null);
      ghost.className = no ? 'cv-drag-ghost no' : 'cv-drag-ghost';
      ghost.textContent = no ? `${label}\n${no}` : label;
      ghost.style.transform = `translate(${ghostAt(x, y, ghost.offsetWidth, ghost.offsetHeight).join('px, ')}px)`;
    },
    /** 창 밖 — 이 창 표는 숨긴다(창 끝에 붙어 남았다, 받는 창이 제 표를 그린다) */
    away(on: boolean) { if (ghost) ghost.style.visibility = on ? 'hidden' : ''; },
    hide() {
      if (!ghost) return;
      ghost.remove();
      ghost = null;
      document.documentElement.classList.remove('cv-dragging');
      light(null);
      lightChat(null);
    },
    chatAt,
  };
}

/** 채팅 입력칸에 글 넣기(멘션·명령) — ChatView 가 받아 글 끝에 붙인다 */
export const insertToChat = (id: string, text: string) => window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id, text } }));

function drop(id: string, p: DragPayload) {
  if (p.kind === 'path') attachToChat(id, [p.path]);
  else if (p.kind === 'paths') attachToChat(id, p.paths);
  else if (p.kind === 'team') window.dispatchEvent(new CustomEvent(TEAM_LOCKER_OUT, { detail: { team: p.team, ids: p.ids, chat: id } }));
  else insertToChat(id, p.text);
}

/** 창 밖 자리인가(창 크기를 모르면 안쪽으로 본다) */
function outside(x: number, y: number): boolean {
  const w = (window as { innerWidth?: number }).innerWidth, h = (window as { innerHeight?: number }).innerHeight;
  return typeof w === 'number' && typeof h === 'number' && (x < 0 || y < 0 || x >= w || y >= h);
}

/** 놓은 자리에 따라 — 채팅 칸·팀 보관함(칩·칸)·참모 보관함 폴더. 이 창에서 놓은 것과 다른 창에서 넘어온 것(__dragIn)이 같이 쓴다 */
function dropAt(payload: DragPayload, x: number, y: number) {
  const self = selfOf(payload);
  const files = payload.kind === 'path' ? [payload.path] : payload.kind === 'paths' ? payload.paths : null;
  // 띠 프사·떠 있는 배지(data-orch-drop) = 그 참모 채팅에 놓기와 같다 — 배지가 그 참모 대화창을 연다(시안 orch-bubble F, 10-28)
  const orch = folderAt(x, y, '[data-orch-drop]')?.dataset.orchDrop;
  if (orch) window.dispatchEvent(new CustomEvent(ORCH_DROPPED, { detail: { id: orch } }));
  const id = chatAt(x, y) ?? (payload.kind !== 'team' ? orch ?? null : null);
  if (id) { drop(id, payload); return; }
  if (payload.kind === 'team') {
    const spot = folderAt(x, y, TEAM_SPOTS);
    if (selfSpot(spot, self)) return; // 자기 폴더·그 안 — 빛이 없던 자리, 놓아도 아무 일 없다
    const chip = spot?.dataset.teamFolder;
    if (chip !== undefined) window.dispatchEvent(new CustomEvent(TEAM_LOCKER_MOVE, { detail: { team: payload.team, ids: payload.ids, folder: chip } }));
    // 띠 참모 프사 = 그 참모에게(채팅 칸에 놓기와 같은 길), 팀 대화 칸 = 그 대화에 첨부(TeamLocker 가 다시 올릴 것만 가른다)
    else if (spot?.dataset.orchDrop) drop(spot.dataset.orchDrop, payload);
    else if (spot && isConvo(spot)) window.dispatchEvent(new CustomEvent(TEAM_LOCKER_OUT, { detail: { team: payload.team, ids: payload.ids, convo: spot } }));
    return;
  }
  if (!files) return;
  // 팀 보관함 — 칩이면 그 폴더, 칸이면 지금 고른 폴더(TeamLocker 가 정한다). 팀 id 는 칸 루트(data-team-id)에
  const team = folderAt(x, y, TEAM_IN);
  if (team) {
    const t = team.closest<HTMLElement>('[data-team-id]')?.dataset.teamId ?? team.dataset.teamId ?? '';
    const chip = team.dataset.teamFolder;
    window.dispatchEvent(new CustomEvent(TEAM_LOCKER_DROP, { detail: chip === undefined ? { paths: files, team: t } : { paths: files, team: t, folder: chip } }));
    return;
  }
  // 빈 글 = 보관함 맨 위(경로 줄 '보관함'·보관함 탭) — 거짓으로 거르면 맨 위로 못 옮겼다
  const at = folderAt(x, y);
  if (selfSpot(at, self)) return;
  const folder = at?.dataset.lockerFolder;
  if (folder !== undefined) for (const path of files) window.dispatchEvent(new CustomEvent(LOCKER_MOVE, { detail: { path, folder } }));
}

/** 끄는 동안 창 밖이면 그 화면 자리를 앱에 알린다 — Rust drag_hover 가 그 자리 다른 앱 창(메신저 따로 창)에 지나감(__dragHover)을 넘긴다.
 *  보낸 게 끝나야 다음을 보낸다(그사이 움직임은 마지막 자리만). end = 창 안으로 돌아옴·취소, stop = 창 밖에서 놓음(drag_out 이 받는 창을 정리한다) */
export function hoverOut(label: string, send = (a: { label: string; x: number | null; y: number | null; team?: true }) => invoke('drag_hover', a), team = false) {
  let chain: Promise<unknown> = Promise.resolve();
  let want: { x: number; y: number } | null = null;
  let queued = false, shown = false, done = false;
  const push = (f: () => Promise<unknown> | undefined) => { chain = chain.then(f).catch(() => {}); };
  return {
    at(x: number, y: number) {
      if (done) return;
      want = { x, y };
      if (queued) return;
      queued = true;
      push(() => {
        queued = false;
        if (done || !want) return undefined;
        const p = want;
        want = null;
        shown = true;
        return send({ label, x: p.x, y: p.y, ...(team ? { team: true as const } : {}) });
      });
    },
    end() {
      want = null;
      if (done || (!shown && !queued)) return;
      shown = false;
      push(() => send({ label, x: null, y: null }));
    },
    stop() { done = true; want = null; },
  };
}

/** 다른 창이 넘긴 자리(창 틀 왼쪽 위 기준, fw·fh = 틀 크기) → 이 창 안 자리. 틀에서 안(웹뷰)을 빼면 양옆·아래 테두리(같은 두께)와 위 제목줄이 남는다.
 *  macOS 26 은 Tauri 창 안 자리가 틀 전체라 제목줄만큼 아래로 읽혔다(10-28 아이맥 실측). 틀 크기가 없으면(옛 판) 받은 자리 그대로 */
export function frameToClient(d: { x: number; y: number; fw?: number; fh?: number }, iw = window.innerWidth, ih = window.innerHeight): [number, number] {
  if (typeof d.fw !== 'number' || typeof d.fh !== 'number' || typeof iw !== 'number' || typeof ih !== 'number' || d.fw < iw || d.fh < ih) return [d.x, d.y];
  const side = (d.fw - iw) / 2;
  return [d.x - side, d.y - (d.fh - ih - side)];
}

// 다른 창에서 끌고 있는 것 — 이 창엔 지나감(__dragHover)만 오고 끌기 사건은 없다. 같은 창 끌기와 같은 표·빛을 쓴다
let remote: ReturnType<typeof dragGhost> | null = null;
const remoteEnd = () => { remote?.hide(); remote = null; };
if (typeof window !== 'undefined') {
  type At = { x: number; y: number; fw?: number; fh?: number };
  const w = window as unknown as { __dragIn?: (d: At & { paths: string[] }) => void; __dragHover?: (d: (At & { label: string; team?: boolean }) | null) => void;
    __dragInTeam?: (d: At & { team: string; ids: string[]; from: string }) => void };
  // 다른 창에서 창 밖으로 끌어 놓은 참모 보관함 파일 — Rust drag_out 이 이 창 틀 기준 자리(x, y, fw, fh)로 부른다
  w.__dragIn = (d) => {
    remoteEnd();
    if (Array.isArray(d?.paths) && d.paths.length) dropAt({ kind: 'paths', paths: d.paths }, ...frameToClient(d));
  };
  w.__dragHover = (d) => {
    if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') { remoteEnd(); return; }
    // 팀 파일은 참모 자리(얼굴·채팅 칸)만 빛내고 이유 줄은 안 단다 — 못 놓은 자리면 놓은 뒤 보낸 창에 한 줄(10-28)
    remote ??= d.team ? dragGhost(String(d.label ?? ''), ORCH_SPOT) : dragGhost(String(d.label ?? ''), true, true);
    remote.move(...frameToClient(d));
  };
  // 다른 창(메신저 따로 창)에서 창 밖으로 끌어 놓은 팀 파일 — 참모 얼굴·채팅 칸이면 그 참모에게(teamGive giveIn), 아니면 보낸 창에 한 줄
  w.__dragInTeam = (d) => {
    remoteEnd();
    if (!d || typeof d.team !== 'string' || !Array.isArray(d.ids) || !d.ids.length || typeof d.x !== 'number' || typeof d.y !== 'number') return;
    const [x, y] = frameToClient(d);
    const orch = folderAt(x, y, ORCH_SPOT)?.dataset.orchDrop;
    const id = chatAt(x, y) ?? orch ?? null;
    if (!id) { void invoke('drag_back', { to: String(d.from ?? ''), team: d.team, text: TEAM_MISS() }).catch(() => {}); return; }
    if (orch && id === orch) window.dispatchEvent(new CustomEvent(ORCH_DROPPED, { detail: { id: orch } }));
    window.dispatchEvent(new CustomEvent(TEAM_GIVE_IN, { detail: { team: d.team, ids: d.ids, to: id } }));
  };
  // 끝 신호를 못 받아도(보낸 창이 멈춤) 이 창을 누르면 지운다 — 다른 창 끌기 중엔 이 창에 마우스 사건이 안 온다
  window.addEventListener('pointerdown', remoteEnd);
}

/** 지금 끌고 있는 것을 끝내는 함수 — 한 번에 하나만(새로 누르면 먼저 것을 끝낸다) */
let endActive: (() => void) | null = null;

function start(e: React.PointerEvent, payload: DragPayload, label: string) {
  if (e.button !== 0 || e.ctrlKey) return; // 우클릭·맥 ctrl+클릭은 끌기가 아니다(메뉴)
  endActive?.();
  const x0 = e.clientX, y0 = e.clientY;
  const files = payload.kind === 'path' ? [payload.path] : payload.kind === 'paths' ? payload.paths : null;
  const g = dragGhost(label, payload.kind === 'team' ? TEAM_SPOTS : !!files, false, selfOf(payload));
  // 참모 보관함 파일·팀 파일이 창을 넘는다 — 창 밖이면 그 자리 다른 창에 지나감을 알린다(팀 파일은 받는 창이 참모 자리만 빛낸다)
  const hover = files ? hoverOut(label) : payload.kind === 'team' ? hoverOut(label, undefined, true) : null;
  // 끝내는 길은 여기 하나 — 놓기·웹뷰가 끌기를 가져감(pointercancel)·창 밖에서 놓기·Esc·창 포커스 잃음 모두 이리 온다.
  // pointerup 하나에만 기대면 놓음 신호가 안 올 때 표가 마우스를 영영 따라다닌다(2026-10-11 사용자)
  const finish = (at: PointerEvent | null) => {
    lost.stop();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
    window.removeEventListener('blur', cancel);
    if (endActive === cancel) endActive = null;
    if (!g.on) return; // 그냥 클릭
    g.hide();
    // 끌기 끝의 클릭은 삼킨다(카드가 열리지 않게)
    const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0); // 클릭이 안 오면 다음 진짜 클릭을 먹지 않게
    const away = !!at && outside(at.clientX, at.clientY);
    if (away) hover?.stop();
    else hover?.end();
    if (!at) return; // 취소 — 아무 데도 안 놓는다
    // 창 밖에서 놓음 — 참모 보관함 파일이면 앱이 그 화면 자리의 다른 창(메신저 따로 창)에 넘긴다(포인터 끌기는 창을 못 넘는다)
    if (away) {
      if (files) void invoke('drag_out', { paths: files, x: at.screenX, y: at.screenY }).catch(() => {});
      // 팀 파일 — 그 자리 창(메인 창 참모 얼굴·채팅 칸)이 받는다. 아무 창 위도 아니면 그때만 한 줄
      else if (payload.kind === 'team') {
        const t = payload;
        void invoke<boolean>('drag_out_team', { team: t.team, ids: t.ids, x: at.screenX, y: at.screenY })
          .then((hit) => { if (!hit) window.dispatchEvent(new CustomEvent(TEAM_LOCKER_OUT, { detail: { team: t.team, ids: [], note: TEAM_MISS() } })); }, () => {});
      }
      return;
    }
    dropAt(payload, at.clientX, at.clientY);
  };
  const cancel = () => finish(null);
  const lost = lostRelease(cancel);
  const up = (ev: PointerEvent) => finish(ev);
  const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finish(null); };
  const move = (ev: PointerEvent) => {
    lost.move(ev.buttons); // 버튼 0 = 뗀 뒤에 처리된 끌기 사건이거나 놓음 신호를 놓친 것 — 끌기는 이어 가며 pointerup 을 잠깐 기다린다(dragEnd)
    if (!g.on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    g.move(ev.clientX, ev.clientY);
    if (hover) {
      const away = outside(ev.clientX, ev.clientY);
      g.away(away);
      if (away) hover.at(ev.screenX, ev.screenY);
      else hover.end();
    }
  };
  endActive = cancel;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key);
  window.addEventListener('blur', cancel);
}

/** 끌 수 있게 — 요소에 펼쳐 넣는다 */
export function dragProps(payload: DragPayload, label: string) {
  if (payload.kind === 'path' && payload.path.startsWith('data:')) return {};
  return { onPointerDown: (e: React.PointerEvent) => start(e, payload, label) };
}

/** 파일·폴더 경로 끌기 */
export const dragPath = (path: string) => dragProps({ kind: 'path', path }, path.split('/').pop() || path);

/** 팀 보관함 파일 끌기(하나 또는 고른 묶음) — 폴더 칩에 놓으면 옮기기, 채팅 칸에 놓으면 그 채팅에 붙이기(TeamLocker 가 풀어서 붙인다) */
export const dragTeam = (team: string, ids: string[], label: string) => dragProps({ kind: 'team', team, ids }, label);

/** 여럿 고른 묶음 끌기 — 폴더에 놓으면 하나씩 옮기기 신호, 채팅에 놓으면 한꺼번에 붙인다. 하나면 dragPath 와 같다 */
export const dragPaths = (paths: string[]) => (paths.length === 1 ? dragPath(paths[0]!) : dragProps({ kind: 'paths', paths }, tr(`${paths.length}개`, `${paths.length} items`)));

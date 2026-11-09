// 팀 보관함 화면 계산(chammo-relay ADR 0009) — Rust team_locker_list 의 줄을 폴더 칩·자리·크기 글로. 화면(ui/team/TeamLocker)과 따로 시험한다
import { tr } from '../i18n';
import { cardThumb, kindOf, pageDoc } from './reader';
import { readSortOf, sortList, type SortState } from './sortList';
import { plainText } from './teamChat';

export type LockerItem = {
  id: string; name: string; size: number; cipher: number; at: number;
  state: 'live' | 'trash'; kind: string; room: string; folder: string;
  by: string; byMember: string; mine: boolean; why: string; deletedAt: number | null;
  /** 빈 폴더 표시 줄(봉한 meta 의 dir) — 줄로는 안 그리고 폴더 칩으로만 */
  dir?: boolean;
  /** 대화 파일 보기에서 이 줄 뒤에 접어 둔 같은 파일 사본 id(roomTwins) — 휴지통·되살리기·영구 지우기를 같이 한다 */
  twins?: string[];
};
export type LockerUsage = { used: number; reserved: number; seats: number; limit: number };
/** cached = 기기에 봉해 둔 마지막 목록(열자마자, 뒤에서 새로 받는 중) · timing = 단계별 ms(재기) */
export type LockerView = { rev: number; usage: LockerUsage; items: LockerItem[]; skipped: string[]; shared: number; cached?: boolean; timing?: Record<string, number> };
/** kind = 무엇을 올리나(file 사람 파일 · profile·avatar·post 앱 안쪽 줄) — 옛 앱은 안 실었다 */
export type LockerUpload = { local: string; team: string; room: string; name: string; done: number; total: number; error: string; kind?: string; folder?: string; note?: string };

/** fileDrop 이 팀 보관함 칸([data-team-locker])에 놓인 파일을 넘기는 사건 — detail {paths, team} */
export const TEAM_LOCKER_DROP = 'team-locker-drop';
/** 팀 보관함 파일을 폴더 칩에 끌어 놓음(ui/space/dragPath) — detail {team, ids, folder('' = 맨 위)} */
export const TEAM_LOCKER_MOVE = 'team-locker-move';
/** 팀 보관함 파일을 채팅 칸에 끌어 놓음 — detail {team, ids, chat(세션 id)}. TeamLocker 가 풀어서 그 채팅에 붙인다 */
export const TEAM_LOCKER_OUT = 'team-locker-out';


export function fmtBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${Math.round(v)}B` : `${v >= 100 || i === 1 ? Math.round(v) : Math.round(v * 10) / 10}${u[i]}`;
}

/** 머리 작은 막대 — '쓴 것 / 한도' 와 비율 */
export function usageText(u: LockerUsage): { text: string; ratio: number } {
  const used = fmtBytes(u.used);
  const lim = fmtBytes(u.limit);
  const sameUnit = used.replace(/[\d.]/g, '') === lim.replace(/[\d.]/g, '');
  return { text: sameUnit ? `${used.replace(/[A-Z]+$/, '')} / ${lim}` : `${used} / ${lim}`, ratio: u.limit > 0 ? Math.min(1, Math.round((u.used / u.limit) * 100) / 100) : 0 };
}

/** 화면에 보이는 줄 = 사람이 올린 파일만. 프로필·사진·팀 홈 글·팀 참모 정의 같은 앱 안쪽 줄(kind ≠ file)과 빈 폴더 표시 줄은 안 보인다 */
const shown = (i: LockerItem) => i.kind === 'file' && !i.dir;

/** 이 기기 몫 열쇠를 기다리는 파일 수 — 보관함에 보이는 살아 있는 파일 중 why 가 있는 것(11-02 새 팀원: 전부 '잠긴 파일'이었다) */
export const lockedFiles = (items: LockerItem[]) => items.filter((i) => shown(i) && i.state === 'live' && i.deletedAt == null && !!i.why).length;

/** 새로 든 팀원 기기 — 팀 열쇠는 켜져 있는 다른 팀원 앱이 넘겨준다. 빈 홈·잠긴 보관함·빈 캘린더가 '없음'처럼 안 보이게 셋이 같은 한 줄 */
export function keyWaitNote(n: number, what: 'post' | 'file' | 'event'): string {
  if (n <= 0) return '';
  const ko = what === 'post' ? `글 ${n}개` : what === 'file' ? `파일 ${n}개` : `일정 ${n}개`;
  const en = what === 'post' ? `${n} post${n > 1 ? 's' : ''}` : what === 'file' ? `${n} file${n > 1 ? 's' : ''}` : `${n} event${n > 1 ? 's' : ''}`;
  return tr(`${ko}는 이 기기 열쇠를 받으면 보여요 — 다른 팀원 앱이 켜져 있으면 곧 열려요`, `${en} will show once this device gets the team key — it arrives when another teammate's app is open`);
}

/** 팀 보관함 올리는 중 줄 — 사람이 올린 팀 파일만(kind 없으면 옛 앱 줄 = 파일). 휴지통·대화 파일 보기에선 없다(대화 첨부는 채팅 칸이 그린다).
 *  10-28 사용자 "프로필 바꾸면 profile.json 112B 카드" — 프로필·사진·글 올리기가 이 줄로 샜다.
 *  at.folder 를 주면 그 파일이 들어갈 폴더에서만(11-04 사용자: 올리는 카드가 모든 폴더에). 안 주면 전체 — 진행 수 셈 */
export function lockerUps(ups: LockerUpload[], at: { trash?: boolean; room?: string; folder?: string }): LockerUpload[] {
  if (at.trash || at.room) return [];
  return ups.filter((u) => (u.kind ?? 'file') === 'file' && !u.room && (at.folder === undefined || (u.folder ?? '') === at.folder));
}

/** 다시 해 보려고 기다리는 중 — 올리기는 저절로 이어지고 사람이 할 일은 없다. 평소엔 빈 글 */
export function upNote(u: { note?: string }): string {
  if (u.note === 'net') return tr('연결이 불안정해서 다시 올리는 중', 'Connection lost, resuming upload');
  if (u.note === 'busy') return tr('서버가 바빠서 잠시 기다려요', 'Server is busy, waiting a bit');
  return '';
}

// ── 폴더 나무 — 폴더는 봉한 meta 의 경로 글('견적/10월', 빈 글 = 맨 위). 파일이 든 경로의 위 폴더는 다 있는 것으로 본다(깊이 제한 없음).
// 옛 앱(0.4.3)이 쓴 한 단계 폴더는 그대로 맨 위 폴더. 빈 폴더는 봉한 표시 줄(dir) ──

/** 팀 보관함 폴더 안 것(팀 파일·표시 줄, 살아 있는 것) — 대화 파일·프로필 사진·휴지통은 폴더가 아니다 */
const teamLive = (i: LockerItem) => i.kind === 'file' && i.state === 'live' && !i.room;
/** path 가 folder 이거나 그 안인가(맨 위는 폴더가 아니다) — Rust team_locker::under 와 같은 규칙 */
export const under = (path: string, folder: string) => !!folder && (path === folder || path.startsWith(`${folder}/`));
export const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
/** 폴더 이름 바꾸기 — 마지막 칸만 새 이름으로(빗금은 칸 나눔이 아니라 -) */
export const renamedPath = (path: string, name: string) => { const p = parentOf(path); const n = name.trim().replace(/\//g, '-'); return p ? `${p}/${n}` : n; };
/** 폴더도 끌고 고른다 — 고르기·끌기 id 는 'dir:<경로>'(파일 id 와 안 겹친다) */
export const dirId = (path: string) => `dir:${path}`;
export const dirOfId = (id: string) => (id.startsWith('dir:') ? id.slice(4) : null);

/** 모든 폴더 경로(위 폴더 포함, 가나다) */
export function allFolders(items: LockerItem[]): string[] {
  const out = new Set<string>();
  for (const i of items) {
    if (!teamLive(i) || !i.folder) continue;
    const parts = i.folder.split('/');
    for (let k = 1; k <= parts.length; k++) out.add(parts.slice(0, k).join('/'));
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
}

export type TeamFolder = { key: string; name: string; n: number };
/** 그 자리 바로 아래 폴더 타일(가나다) — n = 안쪽까지 든 파일 수(참모 보관함 폴더 카드와 같게) */
export function kidFolders(items: LockerItem[], place: string): TeamFolder[] {
  const kids = allFolders(items).filter((f) => parentOf(f) === place);
  const files = items.filter((i) => teamLive(i) && !i.dir);
  return kids.map((key) => ({ key, name: baseOf(key), n: files.filter((i) => under(i.folder, key)).length }));
}

/** 경로 줄 — 맨 위 다음 칸마다 그 자리 경로 */
export function crumbsOf(place: string): { key: string; name: string }[] {
  if (!place) return [];
  const parts = place.split('/');
  return parts.map((name, k) => ({ key: parts.slice(0, k + 1).join('/'), name }));
}

/** 옮길 곳 — 맨 위('') + 모든 폴더. 지금 자리(from, 다 같은 자리에서 왔을 때)와, 옮기는 폴더(dirs) 자신·그 안쪽·이미 그 위 폴더는 뺀다 */
export function moveTargets(items: LockerItem[], o: { from?: string; dirs?: string[] }): string[] {
  const dirs = o.dirs ?? [];
  return ['', ...allFolders(items)].filter((t) => t !== o.from && !dirs.some((d) => under(t, d) || parentOf(d) === t));
}

/** 팀 보관함 한 자리 파일 — 그 폴더에 바로 든 것만(맨 위 = 폴더 밖 파일), trash 면 휴지통 전부(폴더 없이). 팀 파일만(대화 파일은 inRoom). 새것 먼저 */
export function inPlace(items: LockerItem[], place: string, trash = false): LockerItem[] {
  return items
    .filter((i) => shown(i) && !i.room && (trash ? i.state === 'trash' : i.state === 'live' && i.folder === place))
    .sort((a, b) => b.at - a.at);
}

/** 폴더째 내 참모에게 — 그 폴더와 안쪽 폴더의 살아 있는 팀 파일(대화 파일·폴더 표시 줄 빼고). 맨 위는 폴더가 아니라 빈 목록 */
export const folderFiles = (items: LockerItem[], folder: string): LockerItem[] => items.filter((i) => shown(i) && !i.room && !i.dir && i.state === 'live' && under(i.folder, folder));

/** 쌍둥이로 볼 간격 — 보내는 쪽 같은 파일 기억(Rust team_locker_sent KEEP)과 같은 하루 */
const TWIN_MS = 24 * 3600 * 1000;

/** 대화 파일 쌍둥이 — 옛 판(0.4.8 이하)은 못 보낸 첨부 칩을 결과 전에 비워, 다시 넣을 때마다 같은 파일을 새로 올렸다(11-08 팀 DM 2~3벌, 내용 해시 같음).
 *  같은 방·같은 상태·같은 사람·같은 이름·같은 바이트 크기가 하루 안이면 한 파일로 본다 — 남길 것(열 수 있는 것 먼저, 그다음 최신) → 숨길 id 들 */
export function roomTwins(items: LockerItem[], room: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!room) return out;
  const groups = new Map<string, LockerItem[]>();
  for (const i of items) {
    if (!shown(i) || i.room !== room) continue;
    const k = JSON.stringify([i.state, i.byMember || i.by, i.name, i.size]); // 이름에 줄바꿈이 있어도 칸이 안 섞이게
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  for (const g of groups.values()) {
    // 시각순으로 이어 붙인다 — 앞 것과 하루 넘게 떨어지면 새 묶음(같은 이름으로 다시 보낸 다른 날 파일은 따로)
    const runs: LockerItem[][] = [];
    for (const i of [...g].sort((a, b) => a.at - b.at)) {
      const last = runs[runs.length - 1];
      if (last && i.at - last[last.length - 1]!.at <= TWIN_MS) last.push(i);
      else runs.push([i]);
    }
    for (const r of runs) {
      if (r.length < 2) continue;
      const keep = [...r].sort((a, b) => Number(!!a.why) - Number(!!b.why) || b.at - a.at)[0]!;
      out.set(keep.id, r.filter((i) => i !== keep).map((i) => i.id));
    }
  }
  return out;
}

/** 대화 파일 보기 — 그 방(DM·팀챗)에 붙인 파일만, trash 면 그 방 휴지통. 새것 먼저. 쌍둥이(roomTwins)는 하나만, 숨은 것은 twins 에 */
export function inRoom(items: LockerItem[], room: string, trash = false): LockerItem[] {
  if (!room) return [];
  const twins = roomTwins(items, room);
  const hidden = new Set([...twins.values()].flat());
  return items
    .filter((i) => shown(i) && i.room === room && i.state === (trash ? 'trash' : 'live') && !hidden.has(i.id))
    .map((i) => (twins.has(i.id) ? { ...i, twins: twins.get(i.id) } : i))
    .sort((a, b) => b.at - a.at);
}

/** 썸네일 종류 — 대화 말풍선·대화 파일 보기·팀 보관함 카드가 같이 쓴다. 그림은 그대로, page 는 맥 QuickLook 첫 장
 *  (PDF·워드·엑셀·PPT·영상·.ai·.psd·hwpx — 11-01 넓힘, 채팅 카드와 같은 cardThumb). 남이 올린 html 은 바깥 주소를 부를 수 있어 뺀다.
 *  크기 상한: 그림 20MB(말풍선마다 풀어 두니), page 50MB(맥 peek 상한). 크기 모름(0)은 받아 본다 */
export function thumbKind(name: string, size: number): 'image' | 'page' | null {
  const way = cardThumb(name);
  if (way === 'image') return size <= 20 * 1024 * 1024 ? 'image' : null;
  // 영상은 첫 프레임 하나에 통째로 풀어야 해서 20MB 까지(문서는 맥 peek 상한 50MB)
  if (way === 'shot' && kindOf(name) === 'video') return size <= 20 * 1024 * 1024 ? 'page' : null;
  if (way === 'shot' && kindOf(name) !== 'html') return size <= 50 * 1024 * 1024 ? 'page' : null;
  return null;
}

/** 폰에서 누르면 보는 팀 파일(11-01 팀 홈 최근 파일) — 맥이 풀어 주는 그림(/api/team-file-image: png·jpg·gif·webp·heic)은 image,
 *  PDF 는 첫 장 그림(썸네일 길 1600)이라 pdf — 둘은 50MB 넘으면 맥이 안 푼다(peek). 영상(mp4·mov·m4v — 맥 Kind::Video)은 크기 상관없이 video:
 *  맥이 받아 풀고 영상 검토 길(저용량 540p)로 낸다(11-04 사용자 920MB mp4). 못 여는 줄(why)은 뺀다.
 *  문서·글·엑셀·PPT 는 doc — 맥이 풀어 둔 자리를 받아 폰 파일 보기로(11-06 사용자 "디엠 온 거 파일 볼 수가 없음"). 폰 서버 team_doc·shareable 과 같은 형식.
 *  PDF 는 폰 보기가 받는 10MB(MAX_BIN_FILE)까지 doc(모든 쪽), 넘으면 첫 장. html 은 남이 올린 스크립트라, 키노트는 폰 서버가 이름('key')으로 막아 뺀다 */
const PHONE_PICS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'];
const PHONE_VIDEOS = ['mp4', 'mov', 'm4v'];
const PHONE_DOCS = ['md', 'txt', 'json', 'csv', 'tsv', 'log', 'yaml', 'yml', 'toml', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'py', 'rs', 'sh', 'swift', 'kt', 'css', 'sql', 'pptx', 'ppt', 'docx', 'doc', 'pages', 'xlsx', 'xls', 'numbers'];
export function phoneView(f: { name: string; size: number; why?: string }): 'image' | 'pdf' | 'video' | 'doc' | null {
  if (f.why) return null;
  const ext = f.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (PHONE_VIDEOS.includes(ext)) return 'video';
  if (f.size > 50 * 1024 * 1024) return null;
  if (ext === 'pdf') return f.size <= 10 * 1024 * 1024 ? 'doc' : 'pdf';
  return PHONE_PICS.includes(ext) ? 'image' : PHONE_DOCS.includes(ext) ? 'doc' : null;
}

export type DropPlan = { move: string[]; copy: string[]; stay: number; dirs: { from: string; to: string }[]; keep: string[] };
/** 폴더(타일·경로 줄)에 놓은 것 가르기 — 팀 보관함 파일은 옮기고(이미 거기면 빼고), 폴더(dir:경로)는 그 안으로(자기 안·이미 거기면 빼고),
 *  대화 파일은 폴더로 복사(옮기면 대화에서 사라진다, 10-28 사용자). 대화 파일을 맨 위에 놓으면 복사할 폴더가 없다 — stay 로 세어 화면이 이유를 말한다.
 *  keep = 마지막 것이 빠져 비는데 표시 줄이 없는 폴더 — 화면이 먼저 표시 줄을 남겨 빈 폴더가 사라지지 않게(파인더처럼). 못 여는 파일은 셈에서 뺀다 */
export function dropPlan(ids: string[], to: string, find: (id: string) => LockerItem | undefined, items: LockerItem[] = []): DropPlan {
  const out: DropPlan = { move: [], copy: [], stay: 0, dirs: [], keep: [] };
  for (const id of ids) {
    const d = dirOfId(id);
    if (d !== null) { if (d && parentOf(d) !== to && !under(to, d)) out.dirs.push({ from: d, to: to ? `${to}/${baseOf(d)}` : baseOf(d) }); continue; }
    const i = find(id);
    if (!i || i.why) continue;
    if (!i.room) { if (i.folder !== to) out.move.push(id); }
    else if (to) out.copy.push(id);
    else out.stay++;
  }
  // 비는 폴더 — 옮기는 파일의 폴더·옮기는 폴더의 위 폴더 중, 남는 게 없고 표시 줄도 없는 것
  const going = new Set(out.move);
  const gone = (i: LockerItem) => going.has(i.id) || out.dirs.some((x) => under(i.folder, x.from));
  const from = new Set([...out.move.map((id) => find(id)?.folder ?? ''), ...out.dirs.map((x) => parentOf(x.from))].filter(Boolean));
  for (const f of from) if (items.length && !items.some((i) => teamLive(i) && under(i.folder, f) && !gone(i))) out.keep.push(f);
  return out;
}

/** 오늘이면 시:분, 어제, 그 전은 월/일 */
export function whenText(at: number, now = Date.now()): string {
  const d = new Date(at);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86400000);
  if (diff === 0) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff === 1) return tr('어제', 'Yesterday');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const extOf = (n: string) => (n.includes('.') ? n.split('.').pop()!.slice(0, 4) : '');

/** 스페이스(show 길)가 그리는 형식인가 — 글·그림·PDF·md·영상·소리·html·워드, QuickLook 페이지 문서(엑셀·슬라이드). 아니면 맥 기본 앱 */
export const opensInSpace = (name: string) => {
  const k = kindOf(name);
  return (k !== 'other' && k !== 'web') || pageDoc(name);
};

/** 실행될 수 있는 파일이라 Rust 가 먼저 물어보라고 한 답(team_locker_cmd RUN_ASK) — 진짜 파일 이름, 아니면 null. 보이지 않는 글자는 뺀다(오른쪽→왼쪽 표시로 .exe 를 .pdf 처럼 꾸미지 못하게) */
export function runAskName(e: unknown): string | null {
  const at = String(e).indexOf(RUN_ASK);
  return at < 0 ? null : plainText(String(e).slice(at + RUN_ASK.length));
}
const RUN_ASK = 'needs-run-ok:';

/** go 를 먼저 그냥 부르고, 물어보라는 답이면 글자 확인 뒤 runOk 로 한 번 더. 취소면 undefined */
export async function withRunAsk<T>(go: (runOk: boolean) => Promise<T>, ask: (name: string) => Promise<boolean>): Promise<T | undefined> {
  try {
    return await go(false);
  } catch (e) {
    const name = runAskName(e);
    if (name === null) throw e;
    return (await ask(name)) ? go(true) : undefined;
  }
}

/** 팀 파일을 풀어 두는 자리 이름 — Rust team_locker_app::VIEW_DIR 와 같은 글(데이터 폴더 아래) */
export const VIEW_DIR = 'team-locker-peek';
/** 풀어 둔 팀 파일인가 — 스페이스 탭 머리에 내려받기 단추를 붙인다 */
export const isTeamCache = (path: string) => path.replace(/\\/g, '/').split('/').slice(0, -1).includes(VIEW_DIR);

export const SORTS = ['name', 'at', 'size', 'by'] as const;
export type LockerSort = SortState<(typeof SORTS)[number]>;
/** 기억한 정렬 — 모르는 값·막힌 저장소면 기본(올린 날짜 새것 먼저) */
export const readSort = (get: () => string | null): LockerSort => readSortOf(get, SORTS);
/** 줄 정렬 — 같은 값이면 새것 먼저 */
export const sortItems = (items: LockerItem[], s: LockerSort) => sortList(items, s, (i) => i);

/** 영구 지우기를 보여 주나 — 서버(chammo-relay locker.ts purgeFile)는 올린 사람·팀장·'파일 정리' 권한만 받는다(11-01 QA M3: 메뉴는 늘 보이고 누르면 엉뚱한 거절) */
export const canPurge = (i: Pick<LockerItem, 'mine'>, canFiles: boolean): boolean => i.mine || canFiles;

/** 남이 올린 파일 — 휴지통·이름 바꾸기는 서버가 아무 팀원에게나 허용해서, 그 전에 한 번 묻는다(11-01 QA M3) */
export const othersOf = <T extends Pick<LockerItem, 'mine'>>(items: T[]): T[] => items.filter((i) => !i.mine);

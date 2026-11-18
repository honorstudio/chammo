// 참모 프사 저장소 — 앱 전체가 한 지도를 나눠 본다(사이드바·탭·대시보드가 저장 즉시 같이 바뀐다)
import { useSyncExternalStore } from 'react';
import { deleteAvatarFile, getAppEnv, readAvatars, saveAvatarFile } from '../../data/tauri';
import { parseEntries, type Avatar, type AvatarEntry } from '../../domain/avatar';
import { docUrl } from '../../domain/reader';

/** ttsCommand = 설정 음성 명령(App 이 넣는다) — 참모 목소리를 바꿀 수 있는지·기본 목소리(domain/avatar baseVoice).
 *  known = 저장한 프로필을 아나(한 번 읽었거나·지난번 기억이 있거나·읽다 실패해 기본형으로 그리기로 함) — 모르면 폰은 기본 색 대신 빈 자리로 그린다.
 *  fresh = 이번 실행에 맥에서 읽었나(기억만 있으면 그림 프사의 그림은 아직 없다) */
type Snap = { saved: Map<string, AvatarEntry>; dataDir: string; ttsCommand: string; known: boolean; fresh: boolean };
let snap: Snap = { saved: new Map(), dataDir: '', ttsCommand: '', known: false, fresh: false };
let started = false;

/** 읽는 곳 — 앱은 Rust 명령, 폰(모바일 웹)은 /api/avatars 와 그림 blob 으로 바꿔 끼운다(setAvatarSource) */
/** keep = 다시 떠도 남는 기억(폰 localStorage) — 홈 화면 앱이 새로 뜨면 기본 색으로 먼저 그렸다가 맞춰졌다(2026-11-16 사용자) */
type Keep = { load: () => unknown; save: (raw: unknown) => void };
type Source = { read: () => Promise<unknown>; dataDir: () => Promise<string>; image?: (e: AvatarEntry) => string | null; keep?: Keep };
let source: Source = { read: readAvatars, dataDir: () => getAppEnv().then((e) => e.dataDir) };
export function setAvatarSource(s: Partial<Source>) {
  source = { ...source, ...s };
  if (!s.keep || snap.known) return;
  let had: unknown;
  try { had = s.keep.load(); } catch { return; }
  if (Array.isArray(had)) snap = { ...snap, saved: parseEntries(had), known: true };
}
const subs = new Set<() => void>();
const emit = (next: Snap) => {
  const changed = next.saved !== snap.saved;
  snap = next;
  if (changed && source.keep) { try { source.keep.save([...next.saved.values()]); } catch { /* 이번 실행만 */ } }
  subs.forEach((f) => f());
};

// 읽기가 실패하면 빈 값으로 굳히지 않고 아는 값을 둔 채 잠시 뒤 다시(3초부터 두 배, 1분까지). 한 번 실패로 굳었더니
// 폰이 맥 재시작 동안 켜진 뒤로 내내 순서 색(참모-2 주황)으로 그렸다(2026-10-05)
const RETRY_MAX_MS = 60_000;
let retryMs = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let loading: Promise<void> | null = null;

const sameEntries = (a: Map<string, AvatarEntry>, b: Map<string, AvatarEntry>) =>
  a.size === b.size && [...a].every(([k, e]) => JSON.stringify(e) === JSON.stringify(b.get(k)));

/** 다시 읽기 — 폰이 돌아오거나 다시 붙을 때(데스크톱에서 바꾼 것도 따라온다). 읽는 중이면 그 읽기를 같이 기다린다 */
export function refreshAvatars(): Promise<void> {
  loading ??= Promise.all([
    source.read().then(parseEntries, () => null),
    snap.dataDir ? Promise.resolve(snap.dataDir) : source.dataDir().catch(() => ''),
  ]).then(([saved, dataDir]) => {
    loading = null;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    // 안 바뀌었으면 새 값을 안 낸다 — 데스크톱은 폰에서 바꾼 것을 따라오려고 10초마다 다시 읽는다(App)
    if (saved) {
      retryMs = 0;
      if (!sameEntries(saved, snap.saved)) emit({ ...snap, saved, dataDir, known: true, fresh: true });
      else if (dataDir !== snap.dataDir || !snap.fresh || !snap.known) emit({ ...snap, dataDir, known: true, fresh: true });
      return;
    }
    // 못 읽었다 — 모르는 채 빈 자리로 두지 않고 기본형으로(다시 읽기는 아래에서 이어 간다)
    if (dataDir !== snap.dataDir || !snap.known) emit({ ...snap, dataDir, known: true });
    retryMs = Math.min(retryMs ? retryMs * 2 : 3_000, RETRY_MAX_MS);
    retryTimer = setTimeout(() => { retryTimer = null; void refreshAvatars(); }, retryMs);
  });
  return loading;
}

export function loadAvatars() {
  if (started) return;
  started = true;
  void refreshAvatars();
}

/** 지금 값 — 훅 밖(앱이 참모 답을 읽을 때)에서 */
export const avatarSnapshot = (): Snap => snap;

export function setAvatarTts(ttsCommand: string) {
  if (ttsCommand !== snap.ttsCommand) emit({ ...snap, ttsCommand });
}

export function useAvatars(): Snap {
  loadAvatars();
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap);
}

/** 올린 그림 주소 — 리더의 hodoc:// (홈 폴더 안만 내준다. 데이터 폴더가 홈 밖이면 못 읽어 기본형으로 떨어진다) */
export function imageUrl(dataDir: string, e: AvatarEntry | undefined): string | null {
  if (e?.avatar.kind === 'image' && source.image) return source.image(e);
  if (!dataDir || e?.avatar.kind !== 'image') return null;
  return `${docUrl(`${dataDir}/avatars/${e.avatar.file}`)}?v=${e.v}`;
}

/** 저장할 몸 — Rust Avatar 모양(그림 이름은 Rust 가 정한다) */
export const avatarBody = (avatar: Avatar) =>
  avatar.kind === 'preset' ? { ...avatar, voice: avatar.voice ?? null } : { kind: 'image', file: '', crop: avatar.crop, voice: avatar.voice ?? null };

/** 저장한 뒤 — Rust(데스크톱 명령·폰 /api/avatar)가 다시 검사하고 돌려준 값을 한 번 더 걸러 지도에 넣는다 */
export function applySaved(key: string, raw: unknown) {
  const got = parseEntries([raw]).get(key);
  if (!got) throw new Error('saved avatar did not validate');
  const saved = new Map(snap.saved);
  saved.set(key, got);
  emit({ ...snap, saved });
}

export function applyRemoved(key: string) {
  const saved = new Map(snap.saved);
  saved.delete(key);
  emit({ ...snap, saved });
}

export async function saveAvatar(key: string, avatar: Avatar, image: Uint8Array | null): Promise<void> {
  applySaved(key, await saveAvatarFile(key, avatarBody(avatar), image));
}

export async function resetAvatar(key: string): Promise<void> {
  await deleteAvatarFile(key);
  applyRemoved(key);
}

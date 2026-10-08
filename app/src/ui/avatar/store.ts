// 참모 프사 저장소 — 앱 전체가 한 지도를 나눠 본다(사이드바·탭·대시보드가 저장 즉시 같이 바뀐다)
import { useSyncExternalStore } from 'react';
import { deleteAvatarFile, getAppEnv, readAvatars, saveAvatarFile } from '../../data/tauri';
import { parseEntries, type Avatar, type AvatarEntry } from '../../domain/avatar';
import { docUrl } from '../../domain/reader';

/** ttsCommand = 설정 음성 명령(App 이 넣는다) — 참모 목소리를 바꿀 수 있는지·기본 목소리(domain/avatar baseVoice) */
type Snap = { saved: Map<string, AvatarEntry>; dataDir: string; ttsCommand: string };
let snap: Snap = { saved: new Map(), dataDir: '', ttsCommand: '' };
let started = false;

/** 읽는 곳 — 앱은 Rust 명령, 폰(모바일 웹)은 /api/avatars 와 그림 blob 으로 바꿔 끼운다(setAvatarSource) */
type Source = { read: () => Promise<unknown>; dataDir: () => Promise<string>; image?: (e: AvatarEntry) => string | null };
let source: Source = { read: readAvatars, dataDir: () => getAppEnv().then((e) => e.dataDir) };
export function setAvatarSource(s: Partial<Source>) {
  source = { ...source, ...s };
}
const subs = new Set<() => void>();
const emit = (next: Snap) => { snap = next; subs.forEach((f) => f()); };

// 읽기가 실패하면 빈 값으로 굳히지 않고 아는 값을 둔 채 잠시 뒤 다시(3초부터 두 배, 1분까지). 한 번 실패로 굳었더니
// 폰이 맥 재시작 동안 켜진 뒤로 내내 순서 색(참모-2 주황)으로 그렸다(2026-10-05)
const RETRY_MAX_MS = 60_000;
let retryMs = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let loading: Promise<void> | null = null;

/** 다시 읽기 — 폰이 돌아오거나 다시 붙을 때(데스크톱에서 바꾼 것도 따라온다). 읽는 중이면 그 읽기를 같이 기다린다 */
export function refreshAvatars(): Promise<void> {
  loading ??= Promise.all([
    source.read().then(parseEntries, () => null),
    snap.dataDir ? Promise.resolve(snap.dataDir) : source.dataDir().catch(() => ''),
  ]).then(([saved, dataDir]) => {
    loading = null;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (saved) { retryMs = 0; emit({ ...snap, saved, dataDir }); return; }
    if (dataDir !== snap.dataDir) emit({ ...snap, dataDir });
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

/** 저장 — Rust 가 다시 검사하고 돌려준 값으로 지도를 고친다 */
export async function saveAvatar(key: string, avatar: Avatar, image: Uint8Array | null): Promise<void> {
  const body = avatar.kind === 'preset' ? { ...avatar, voice: avatar.voice ?? null } : { kind: 'image', file: '', crop: avatar.crop, voice: avatar.voice ?? null };
  const got = parseEntries([await saveAvatarFile(key, body, image)]).get(key);
  if (!got) throw new Error('saved avatar did not validate');
  const saved = new Map(snap.saved);
  saved.set(key, got);
  emit({ ...snap, saved });
}

export async function resetAvatar(key: string): Promise<void> {
  await deleteAvatarFile(key);
  const saved = new Map(snap.saved);
  saved.delete(key);
  emit({ ...snap, saved });
}

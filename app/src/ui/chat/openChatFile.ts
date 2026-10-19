// 채팅에서 파일·그림 열기 — scripts/show 와 같은 자리: 채팅 뷰는 왼쪽 스페이스(SpaceView 가 CHAT_FILE_OPEN 을 받아 show 길로), 터미널 뷰는 리더.
// 참모가 띄운 파일 카드·말풍선에 붙은 그림(#img1)·파일(#file1)이 같이 쓴다(2026-10-19 사용자 "스페이스에서 열리는 게 맞는 액션")
import { invoke } from '@tauri-apps/api/core';
import type { ShowAt } from '../../domain/showAt';

/** 스페이스에 열기 신호 — detail = { path, at, by(띄운 참모 id) } */
export const CHAT_FILE_OPEN = 'chat-file-open';

// 같은 그림을 다시 눌러도 파일을 또 만들지 않게 — data URL → 저장한 경로
const saved = new Map<string, Promise<string>>();

/** 경로 없는 그림(채팅에 붙인 그림 data URL) → <데이터>/attach 에 저장한 경로. 경로면 그대로, 모르는 data URL 은 거절 */
export function imageFile(src: string): Promise<string> {
  if (!src.startsWith('data:')) return Promise.resolve(src);
  const m = src.match(/^data:image\/(\w+);base64,(.*)$/);
  if (!m) return Promise.reject(new Error('not an image'));
  let p = saved.get(src);
  if (!p) {
    const bytes = Array.from(Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0)));
    p = invoke<string>('save_attach', { name: `pasted.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, bytes });
    p.catch(() => saved.delete(src)); // 실패하면 다음에 다시
    saved.set(src, p);
  }
  return p;
}

export async function openChatFile(src: string, by: string, at?: ShowAt): Promise<void> {
  const path = await imageFile(src).catch(() => '');
  if (!path) return;
  if (document.querySelector('.space-mode')) window.dispatchEvent(new CustomEvent(CHAT_FILE_OPEN, { detail: { path, by, ...(at ? { at } : {}) } }));
  else await invoke('reader_open', { paths: [path] }).catch(() => {});
}

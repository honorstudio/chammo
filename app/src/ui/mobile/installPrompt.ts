// 안드로이드 크롬 설치 창(beforeinstallprompt) — 폰 화면이 뜨기 전에 올 수 있어 모듈을 일찍 불러 붙잡아 둔다(mobile.tsx).
// 안드로이드는 크롬 탭과 설치한 앱이 저장을 같이 써서 연결이 그대로 넘어간다 — 아이폰처럼 코드를 붙여 넣을 일이 없다(2026-11-18 사용자 "설치해서 쓰게")
import { useSyncExternalStore } from 'react';

type Prompt = Event & { prompt: () => Promise<void> };
let prompt: Prompt | null = null;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e as Prompt; ping(); });
  window.addEventListener('appinstalled', () => { prompt = null; ping(); });
}

/** 지금 설치 창을 띄울 수 있나 — 이미 설치했거나 크롬이 안 주면 false */
export function useInstallPrompt(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => !!prompt, () => false);
}

/** 설치 창은 한 번만 띄울 수 있다 — 띄우고 나면 단추를 뺀다 */
export async function showInstall() {
  const p = prompt;
  prompt = null;
  ping();
  await p?.prompt().catch(() => {});
}

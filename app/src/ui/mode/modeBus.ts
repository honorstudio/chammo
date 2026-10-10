// Rust(modes_host) → 웹 밀림 입구 — window.__mode({name, ev}) 를 창 안 사건으로 바꾼다. 메인 창·모드 창이 한 번씩 건다
import { invoke } from '@tauri-apps/api/core';
import { newModeAsk } from '../../domain/modeTree';
import { CHAT_INSERT } from '../space/dragPath';

export type ModeMsg = { name: string; ev: { subtype?: string; text?: string; timeout_ms?: number; where?: string; dash?: string | null; instances?: unknown; on?: boolean } };
export const MODE_EVENT = 'chammo-mode';

// 메뉴 '지금 대시보드 칸으로 켜기' — 지금 보는 대시보드는 화면만 안다(SpaceView 가 알려 둔다). 대시보드가 없으면 따로 창으로
let dashHere: string | null = null;
export const setModeDashHere = (t: string | null) => { dashHere = t; };
// 메뉴 '새 모드 만들기…' — 지금 채팅 탭 참모(SpaceView 가 알려 둔다) 입력칸에 한 줄
let chatHere: string | null = null;
export const setModeChatHere = (id: string | null) => { chatHere = id; };

export function installModeBus() {
  const w = window as unknown as { __mode?: (m: ModeMsg) => void; __modeDash?: (name: string) => void; __modeNew?: () => void };
  w.__mode = (m) => window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: m }));
  w.__modeDash = (name) => {
    const args = dashHere ? { name, place: 'dash', dash: dashHere } : { name, place: 'window' };
    void invoke('mode_open', args).catch(() => {});
  };
  w.__modeNew = () => { if (chatHere) window.dispatchEvent(new CustomEvent(CHAT_INSERT, { detail: { id: chatHere, text: newModeAsk() } })); };
}

import { createContext } from 'react';

/** 채팅 입력칸 옆 음성 모드 단추 — 참모 채팅 열(스페이스)만 App 이 감싸 준다. 없으면 단추도 없다(2026-10-11 사용자) */
export const ChatVoice = createContext<{ on: boolean; toggle: () => void } | null>(null);

// 세션이 시간 초과로 안 기다리던 사람 부름(browser_ask_human)을 사람이 끝내면 그 세션 입력칸에 [앱] 줄로 깨운다(2026-10-23 acme-shop —
// 세션이 로그인 카드를 띄우고 턴을 끝낸 뒤 사용자가 폰에서 끝내도 세션은 30분 크론까지 몰랐다). 판단은 Rust apply_wake + domain/agentAsk askWakes
import { useEffect, useRef } from 'react';
import { sendToSession } from '../data/tauri';
import { askWakes } from '../domain/agentAsk';
import type { Live } from '../domain/agentBrowser';
import type { Session } from '../domain/session';

const RETRY_MS = 10_000;
const MAX_TRIES = 5;

export function useAskWake(lives: Live[], sessions: Session[]) {
  const sent = useRef<string[]>([]); // 보냈거나 보내는 중인 부름
  const tries = useRef(new Map<string, number>());
  useEffect(() => {
    for (const w of askWakes(lives, sessions, sent.current)) {
      sent.current = [...sent.current, w.key].slice(-100);
      void sendToSession(w.id, w.line).catch(() => {
        // 막 켠 세션은 화면이 아직 안 떠 실패하기 쉽다 — 간격을 두고 몇 번만 다시
        const n = (tries.current.get(w.key) ?? 0) + 1;
        tries.current.set(w.key, n);
        if (n < MAX_TRIES) window.setTimeout(() => { sent.current = sent.current.filter((k) => k !== w.key); }, RETRY_MS * n);
      });
    }
  }, [lives, sessions]);
}

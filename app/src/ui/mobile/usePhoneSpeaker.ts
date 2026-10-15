// 폰에서 지금 말하는 참모 — 입력칸 참모 단추가 그 참모 프사로 바뀌고 소리 크기대로 빛난다(2026-10-12 사용자 "어떤 참모가 말하는지 구분이 안 가").
// 누가·곡선은 맥 하트비트 답(data/phoneVoice), 판단(끝난 뒤 HOLD_MS·빛 세기)은 domain/phoneVoice — 빛 셈은 데스크톱 말하는 빛(levelAt)과 같다
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSay, subscribeSay } from '../../data/phoneVoice';
import { HOLD_MS, sayLevel, speakerShown } from '../../domain/phoneVoice';
import { motionOn } from '../calm';

/** 입력칸 참모 단추에 보일 말하는 참모(세션 짧은 id) — 없으면 null(원래 참모). 끝난 뒤 HOLD_MS 가 지나면 저절로 null */
export function usePhoneSpeaker(): string | null {
  const s = useSyncExternalStore(subscribeSay, getSay);
  const [, wake] = useState(0);
  useEffect(() => {
    if (s?.endedMs == null) return;
    const left = HOLD_MS - (Date.now() - s.endedMs);
    if (left <= 0) return;
    const t = window.setTimeout(() => wake((n) => n + 1), left);
    return () => window.clearTimeout(t);
  }, [s]);
  return speakerShown(s, Date.now());
}

/** 말하는 빛 — el 에 --speak-level(0~1)을 프레임마다. 줄이기·움직임 줄이기면 일정한 빛 한 번만, 끝나면 0 */
export function useSpeakLevel(el: HTMLElement | null, on: boolean) {
  const s = useSyncExternalStore(subscribeSay, getSay);
  useEffect(() => {
    if (!el) return;
    const put = (v: number) => el.style.setProperty('--speak-level', v.toFixed(3));
    if (!on || !s || s.endedMs !== null) { put(0); return; }
    const reduced = !motionOn();
    if (reduced) { put(sayLevel(s, Date.now(), true)); return; }
    let raf = 0;
    const frame = () => {
      put(sayLevel(s, Date.now(), false));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [el, on, s]);
}

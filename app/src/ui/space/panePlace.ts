// 네이티브 비추기 칸 자리 알리기 — Craft 맥 앱 칸(CraftPane)과 세션 브라우저 칸(BrowserPane)이 같이 쓴다.
// 칸 자리·보이는지를 매 프레임 재서 바뀔 때만 Rust 에 알린다(WebPage 미리보기와 같은 길). 덮이면(팝오버) 비추기는 숨고(팝오버가 위에 보이게)
// 그 자리에 그림을 깐다(still) — 받기는 계속하고 덮인 동안 그 그림을 계속 갈아 끼운다(11-18 사용자 '알림이 떠 있으면 브라우저가 멈춤'). refresh 마다 바뀌지 않아도 다시 알린다(따로 창이 닫히면 다시 붙게·창 모양을 새로 받게)
import { useEffect, useState } from 'react';
import { boxOf, coveredAt, COVERS, paneMode, POPS, popOverlaps, sameBox, stillDue, type Box, type PaneMode } from '../../domain/craftTab';

export type PaneApi = {
  /** covered = 덮임 — 비추기는 숨기되 받기는 계속(그림을 still 로 갈아 끼운다) */
  place: (rect: Box, vh: number, visible: boolean, covered: boolean) => Promise<string>;
  still: () => Promise<string>;
  detach: () => void;
};

/** answer = place 의 마지막 답(Craft "window"·브라우저 "live"/"waiting"/…), still = 덮였을 때 깔 마지막 그림. key 가 바뀌면 새로 붙는다 */
export function usePanePlace(on: boolean, stage: React.RefObject<HTMLElement | null>, api: PaneApi, key: string, refresh = 1500) {
  const [answer, setAnswer] = useState('');
  const [still, setStill] = useState('');
  useEffect(() => {
    if (!on) return;
    let last: Box | null = null;
    let mode: PaneMode | null = null;
    const pic = { inFlight: false, at: 0 };
    const grab = () => {
      pic.inFlight = true;
      pic.at = Date.now();
      return api.still().then((u) => { if (alive && u) setStill(u); }, () => {}).finally(() => { pic.inFlight = false; });
    };
    let lastVh = 0;
    let frame = 0;
    let poked = false;
    let id = 0;
    let alive = true;
    const tick = () => {
      const el = stage.current;
      if (el) {
        const b = boxOf(el.getBoundingClientRect(), window.devicePixelRatio);
        // 9점 훑기는 6프레임마다(초당 10번) — 매 프레임은 아깝다
        if (frame++ % 6 === 0) {
          const pops = [...document.querySelectorAll(POPS)].filter((p) => !el.contains(p)).map((p) => boxOf(p.getBoundingClientRect()));
          poked = popOverlaps(b, pops) || coveredAt(b, (x, y) => document.elementFromPoint(x, y), (n) => n instanceof Node && el.contains(n));
        }
        const covered = !!document.querySelector(COVERS) || poked;
        // 앱 창이 숨었으면(최소화·가려짐) 안 보임 — 그동안 SCK·그림 받기는 멈춘다(Rust mark_pane). 덮였으면 비추기만 숨고 받기는 계속
        const m = paneMode(b, covered, document.visibilityState === 'hidden');
        const vh = window.innerHeight; // 맥 제목줄 밑 깔림 재기(webpage.rs content_origin 과 같은 이유)
        if (!sameBox(last, b) || m !== mode || vh !== lastVh) {
          const was = mode;
          last = b;
          mode = m;
          lastVh = vh;
          const go = () => void api.place(b, vh, m === 'shown', m === 'covered').then((r) => { if (alive) setAnswer(r); }, () => {});
          if (m === 'covered' && was !== 'covered') {
            // 마지막 그림을 먼저 받아 깔고 나서 비추기를 숨긴다 — 숨긴 뒤 받으면 그 사이 칸이 까맣게 번쩍였다(10-28 사용자 ⋯ 메뉴). 늦어도 0.2초 안에 숨긴다
            let sent = false;
            const once = () => { if (!sent) { sent = true; go(); } };
            setTimeout(once, 200);
            void grab().finally(() => requestAnimationFrame(once));
          } else go();
        } else if (stillDue(m, pic.inFlight, pic.at, Date.now())) void grab(); // 덮인 동안 — 깐 그림을 갈아 끼운다
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    const again = setInterval(() => { last = null; }, refresh);
    return () => { alive = false; cancelAnimationFrame(id); clearInterval(again); api.detach(); };
  }, [on, stage, key, refresh]); // eslint-disable-line react-hooks/exhaustive-deps -- api 는 key 로 바뀜을 안다
  return { answer, still };
}

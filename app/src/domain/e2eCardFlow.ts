// 허용 카드 숫자 흐름(chammo-relay ADR 0007) — 화면 틀 없이 묻는 차례만. 훅(ui/e2e/NumberEntry useCardNumber)이 감싼다.
// 중계는 먼저 온 기기 하나의 난수(nM)만 받는다 — 그래서 카드를 그리기만 해서는 안 내고, 사람이 숫자 칸을 누를 때(claim) 낸다.
// 10-27 사용자: 무인 아이맥 채팅 뷰가 그리자마자 자리를 잡아 맥북 종 카드가 '기다려요'에 갇혔고, 2초마다 다시 쏘다 중계 한도(429)에 걸렸다
import type { CardMode, NumberApi, Opened } from './e2eNumber';

export type CardState = { mode: 'loading' | CardMode; code: string; ready: boolean; mine: boolean; err: string };

/** 숫자 준비를 묻는 사이 — 처음 30초는 2초, 그 뒤 8초(사람이 자리를 떠도 10분에 90개 밑 — 중계는 기기 열쇠마다 10분 300개) */
export const readyEvery = (n: number) => (n < 15 ? 2000 : 8000);
/** 새 컴퓨터가 봉인을 올리길 기다릴 때 다시 열기 — 상태 파일만 읽어 망을 안 쓴다 */
const WAIT_EVERY = 2000;
/** 사람 손 claim 사이 최소 — 키를 칠 때마다 중계에 가지 않게 */
const CLAIM_GAP = 3000;

const msg = (x: unknown) => (x instanceof Error ? x.message : String(x));

export function cardFlow(dev: string, api: NumberApi, emit: (s: CardState) => void) {
  let st: CardState = { mode: 'loading', code: '', ready: false, mine: false, err: '' };
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = 0;
  let want = false;
  let claiming = false;
  let lastClaim = -Infinity;

  const set = (p: Partial<CardState>) => {
    if (!live) return;
    st = { ...st, ...p };
    emit(st);
  };
  const plan = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!live) return;
    if (st.mode === 'wait') timer = setTimeout(() => void api.open(dev).then(apply, () => plan()), WAIT_EVERY);
    else if (st.mode === 'number' && st.mine && !st.ready) {
      timer = setTimeout(() => {
        asked++;
        void api.ready(dev).then((r) => { set({ ready: r, err: '' }); plan(); }, (x) => { set({ err: msg(x) }); plan(); });
      }, asked === 0 ? 0 : readyEvery(asked));
    }
  };
  const apply = (m: Opened) => {
    set({ mode: m.mode, code: m.code, mine: m.mine });
    if (want && m.mode === 'number' && !m.mine) grab();
    plan();
  };
  const grab = () => {
    if (claiming || !live) return;
    claiming = true;
    lastClaim = Date.now();
    void api.claim(dev).then((m) => { set({ err: '' }); apply(m); }, (x) => set({ err: msg(x) })).finally(() => { claiming = false; });
  };

  return {
    start() {
      void api.open(dev).then(apply, () => { set({ mode: 'wait' }); plan(); });
    },
    /** 사람이 숫자 칸을 눌렀다 — trusted 는 진짜 클릭·키(isTrusted)일 때만 true */
    claim(trusted: boolean) {
      if (!trusted || st.mine) return;
      want = true;
      if (st.mode !== 'number' || Date.now() - lastClaim < CLAIM_GAP) return;
      grab();
    },
    stop() {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

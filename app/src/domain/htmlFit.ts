// 폰 html 시안 보기 — 넓은 시안(PC 1440 등)을 폰 폭에 맞추는 배율, 두 손가락 배율(전략 표 6번, 2026-10-03). 화면 없음

/** 시안 폭(contentW)이 칸(boxW)보다 넓으면 맞춤 배율, 아니면 1 — 몇 점 넘침(스크롤 막대 등)은 그대로 */
export const draftFit = (contentW: number, boxW: number) => (contentW > boxW + 4 && boxW > 0 ? boxW / contentW : 1);

/** 지금 배율 z 에 두 손가락 비율 k 를 곱해 min~max 로 */
export const pinchZoom = (z: number, k: number, min: number, max: number) => (Number.isFinite(k) && k > 0 ? Math.min(max, Math.max(min, z * k)) : z);

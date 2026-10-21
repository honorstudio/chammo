// 지금 Craft 탭(k:<앱>)이 떠 있는 참모 — 스페이스가 탭을 띄울 때 적고, 돌려받음 [앱] 줄을 그 참모에게 보낸다(useCraftHandback).
// 사람이 연 인스턴스(띄운 세션 없음)는 이게 주인이다(domain/craftDock craftOwnerOf) — 앱이 꺼지면 지운다(같은 키를 다음 인스턴스가 물려받지 않게)
const owners = new Map<string, { orch: string; at: number }>();

export function setCraftOwner(app: string, orchId: string, at = Date.now()) {
  owners.set(app, { orch: orchId, at });
}

export const craftOwner = (app: string) => owners.get(app)?.orch;

/** 꺼진 인스턴스 기억 지우기 — goneFor(ms) 전부터 안 보였으면 그보다 늦게 적힌 것은 새 인스턴스 것이라 남긴다
 *  (끈 뒤 곧바로 서랍에서 같은 키로 다시 띄우면 늦은 꺼짐 판정이 새 주인을 지웠다, 2026-10-21 리뷰) */
export function forgetCraftOwner(app: string, now = Date.now(), goneFor = 0) {
  const o = owners.get(app);
  if (o && o.at <= now - goneFor) owners.delete(app);
}

// 지금 Craft 탭(k:<앱>)이 떠 있는 참모 — 스페이스가 탭을 띄울 때 적고, 돌려받음 [앱] 줄을 그 참모에게 보낸다(useCraftHandback)
const owners = new Map<string, string>();

export function setCraftOwner(app: string, orchId: string) {
  owners.set(app, orchId);
}

export const craftOwner = (app: string) => owners.get(app);

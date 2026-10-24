// 폰 뽑기 다리 — 폰 서버(phone_gacha.rs)가 eval 로 window.__gachaPhone({key, req}) 를 부르면 맥 앱 한 줄(useGacha phone)에서 처리하고 그 대기표로 답한다.
// 처리하다 던지면 답하지 않는다(폰 서버가 시간 초과로 알린다)
import type { PhoneReply } from '../../domain/phoneGacha';

export function gachaBridge(handle: (req: unknown, off: boolean) => Promise<PhoneReply>, reply: (key: string, r: PhoneReply) => Promise<void>, off: () => boolean) {
  return (m: { key: string; req: unknown }): Promise<void> =>
    handle(m.req, off()).then((r) => reply(m.key, r)).catch(() => { /* 답이 없으면 폰 서버가 시간 초과로 알린다 */ });
}

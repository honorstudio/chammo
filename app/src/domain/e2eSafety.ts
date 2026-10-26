// 보안 번호 받아들이기·대화 속 종단 암호 표시(시안 docs/design-drafts/e2e-safety v1, chammo-relay ADR 0007 결정 2·5) — 화면 판단만.
// 받아들이기·막아 두기는 결정 대기함 카드 답(direct_answer — 데스크톱 메인 창·짝지은 폰)으로만 간다
import { tr } from '../i18n';

/** Rust e2e_safety::Person + 열린 카드 id(card — 대화 '확인'이 그 카드 답 문으로) */
export type SafetyPerson = {
  account: string; team: string; member: string; name: string;
  /** ok(아직 안 견줌) · verified(확인됨) · changed(바뀜) · forked(갈림) */
  state: string; verifiedAt: number; blocked: boolean; number: string; card: string;
  /** 번호를 셈한 사슬 · 갈림을 '다시 받기'했나 */
  identity: string; head: string; refetched: boolean;
};

/** 갈림은 '다시 받기' 전엔 번호 비교·받아들이기가 없다(6차 리뷰 — 다시 받은 사슬의 번호를 견줘야) */
export const needsRefetch = (x: { safety?: string; state?: string; refetched?: boolean }) => (x.safety ?? x.state) === 'forked' && !x.refetched;

/** 보안 번호 30자리 → 5자리 여섯 묶음. 모양이 틀리면 빈 목록(보여 주지 않는다) */
export const safetyGroups = (code: string): string[] => (/^(\d{5} ){5}\d{5}$/.test(code) ? code.split(' ') : []);

/** 멤버 줄 상태 글 — ok = 확인됨(초록 점) */
export function safetyLabel(p: SafetyPerson): { text: string; ok: boolean } {
  if (p.state === 'changed') return { text: p.blocked ? tr('보안 번호가 바뀌어 막아 뒀어요', 'Safety number changed — kept blocked') : tr('보안 번호가 바뀌었어요', 'Safety number changed'), ok: false };
  if (p.state === 'forked') return { text: p.blocked ? tr('기기 목록이 달라 막아 뒀어요', 'Device list differs — kept blocked') : tr('기기 목록이 다르게 보여요', 'Device list looks different'), ok: false };
  if (p.state === 'verified') {
    const d = new Date(p.verifiedAt);
    return { text: tr(`보안 번호 확인됨 · ${d.getMonth() + 1}/${d.getDate()}`, `Safety number verified · ${d.getMonth() + 1}/${d.getDate()}`), ok: true };
  }
  return { text: tr('보안 번호 아직 안 견줌', 'Safety number not compared yet'), ok: false };
}

/** 대화 칸의 종단 암호 표시 — Rust 인박스 기록 note 그대로. block = 받지 않은 말, warn = 열었지만 참모에게 안 넘긴 말(본문은 보여 준다) */
export function e2eLine(note: string, who: string): { tone: 'block' | 'warn'; text: string } | null {
  switch (note) {
    case 'e2e-plain': return { tone: 'block', text: tr(`${who}에게서 암호 없이 온 말 — 받지 않았어요(옛 판 앱일 수 있어요)`, `A message from ${who} without encryption — not accepted (maybe an old app)`) };
    case 'e2e-old': return { tone: 'block', text: tr('30일 넘게 지난 말이라 받지 않았어요 — 오래 꺼져 있던 기기의 밀린 말이거나 보낸 기기 시계가 틀렸을 수 있어요', 'Over 30 days old — not accepted (a long-offline device, or a wrong clock)') };
    case 'e2e-future': return { tone: 'block', text: tr('보낸 시각이 하루 넘게 미래인 말이라 받지 않았어요 — 보낸 기기 시계가 틀렸을 수 있어요', 'Dated more than a day in the future — not accepted (wrong clock?)') };
    case 'e2e-fail': return { tone: 'block', text: tr('이 기기에서 못 연 암호 말이에요', "An encrypted message this device couldn't open") };
    case 'e2e-changed': return { tone: 'warn', text: tr(`보안 번호가 바뀐 ${who}의 말 — 확인 전엔 참모에게 안 넘겨요`, `From ${who}, whose safety number changed — not passed to assistants until you check`) };
    case 'e2e-fork': return { tone: 'warn', text: tr(`${who}의 기기 목록이 다르게 보일 때 온 말 — 확인 전엔 참모에게 안 넘겨요`, `From ${who} while their device list looks different — not passed to assistants until you check`) };
    default: return null;
  }
}

import { REF_PREFIX } from './chatTokens';
import { nextEmpties } from './termInput';

// 채팅 입력칸 위 첨부 줄 — 터미널 입력칸에 붙인 그림·파일을 썸네일·이름표(#img1·#file1)로 보여 준다.
// 그림·경로는 터미널 입력칸에 들어가 있어서 Enter 한 번에 그 말과 같이 간다(ChatView)

export type Att = { key: string; url?: string; name: string; label?: string; path?: string };
/** list = 줄에 보이는 것 · img·file = 마지막으로 준 번호 · empties = 터미널 입력칸이 빈 걸 연달아 본 수 · lastAt = 마지막으로 붙인 때 */
export type AttState = { list: Att[]; img: number; file: number; empties: number; lastAt: number };
export const NO_ATT: AttState = { list: [], img: 0, file: 0, empties: 0, lastAt: 0 };

export type AttEvent =
  | { kind: 'add'; item: Att; as: 'img' | 'file'; now: number }
  /** 채팅에서 말을 보냈다(일하는 중이면 대기열로) */
  | { kind: 'sent' }
  /** 보내기가 실패했다 — 그 말과 같이 가려던 것을 줄에 되돌린다 */
  | { kind: 'back'; went: Att[] }
  /** 0.4초마다 터미널 입력칸 읽기 — raw '' = 비었음, null = 못 읽음, undefined = 보낸 직후 잠깐 안 읽음 */
  | { kind: 'read'; raw: string | null | undefined; draft: string; now: number }
  | { kind: 'clear' };

const TAG = /[#@](img|file)\d+/;
const num = (list: Att[], kind: 'img' | 'file') => Math.max(0, ...list.map((a) => (a.label?.startsWith(`${REF_PREFIX}${kind}`) ? Number(a.label.slice(REF_PREFIX.length + kind.length)) || 0 : 0)));

/** went = 보낸 말과 같이 간 것(대기 말풍선에 붙인다) · idle = 터미널 입력칸이 오래 비어 번호를 처음부터(붙여 넣은 글 길이도 0 으로) */
export function attachStep(s: AttState, e: AttEvent): { s: AttState; label?: string; went?: Att[]; idle?: boolean } {
  switch (e.kind) {
    case 'add': {
      const n = (e.as === 'img' ? s.img : s.file) + 1;
      const label = `${REF_PREFIX}${e.as}${n}`;
      return { s: { ...s, list: [...s.list, { ...e.item, label }], [e.as]: n, empties: 0, lastAt: e.now }, label };
    }
    // 보낸 말과 같이 갔다 — 줄을 바로 비운다. 입력칸 읽기가 빌 때까지 기다리면 그 사이 다음 그림을 붙이는 순간(이름표가 입력칸에 생겨)
    // 앞 그림이 영영 남고 번호가 이어졌다(2026-11-05 사용자 '계속 첨부 중')
    case 'sent':
      return { s: { ...NO_ATT, lastAt: s.lastAt }, went: s.list };
    case 'back': {
      const have = new Set(s.list.map((a) => a.key));
      const list = [...e.went.filter((a) => !have.has(a.key)), ...s.list];
      return { s: { ...s, list, img: Math.max(s.img, num(list, 'img')), file: Math.max(s.file, num(list, 'file')), empties: 0 } };
    }
    case 'read': {
      const empties = nextEmpties(s.empties, e.raw); // 못 읽음(null)·잠깐 안 읽음(undefined)은 빈 칸이 아니다
      // 입력칸에 이름표가 남아 있거나 방금 붙였으면 아직 쓰는 중 — 번호를 1로 되돌리면 두 파일이 같은 #file1 이 됐다(2026-09-30 사용자)
      if (empties >= 4 && !TAG.test(e.draft) && e.now - s.lastAt > 5000) return { s: { ...NO_ATT, empties }, idle: true };
      return { s: empties === s.empties ? s : { ...s, empties } };
    }
    case 'clear':
      return { s: NO_ATT };
  }
}

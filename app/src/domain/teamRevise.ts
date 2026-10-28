// 팀 보관함 파일 수정본(10-28 사용자 1안) — 팀에서 연 파일을 사람이 고쳐 저장하면 '팀 보관함에 수정본 올리기'(누를 때만, 팀 모두에게 바로 보이니까).
// 이름은 참모에게 준 사본의 수정본 규칙(안내문 CHAMMO.md '<원래 이름> (수정).<확장자>')과 같다. 같은 사람이 다시 올리면 자기 수정본을 새 판으로
// (옛 판은 휴지통 30일), 다른 사람이 같은 원본을 고치면 '(수정 - <그 사람 이름>)' 로 따로 — '(수정 2)' 로 늘리지 않는다
import { tr } from '../i18n';
import type { LockerItem } from './teamLocker';

const SUFFIX = / \(수정(?: - [^()]+)?\)$/;

/** 이름 → [앞, 확장자(점 없이, 없으면 빈 글)] — 점으로 시작하는 이름의 첫 점은 확장자가 아니다 */
function split(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name, ''];
}
const join = (stem: string, ext: string) => (ext ? `${stem}.${ext}` : stem);

/** 수정본 이름이면 원래 이름 — '로고 (수정).ai'·'로고 (수정 - 지수).ai' → '로고.ai' */
export function reviseBase(name: string): string {
  const [stem, ext] = split(name);
  return join(stem.replace(SUFFIX, ''), ext);
}

export type RevisePlan = { name: string; folder: string; replace: string | null };

/** 올릴 이름·폴더와 휴지통으로 보낼 내 옛 판 — items = 지금 팀 보관함 목록, me = 내 이름(팀 명부) */
export function revisePlan(orig: LockerItem, items: LockerItem[], me: string): RevisePlan {
  const [stem, ext] = split(reviseBase(orig.name));
  // 대화 파일은 그 방 사람만 본다 — 수정본은 팀 보관함 맨 위로(방엔 안 올린다)
  const folder = orig.room ? '' : orig.folder;
  const plain = join(`${stem} (수정)`, ext);
  const who = me.trim() || tr('나', 'me');
  const named = join(`${stem} (수정 - ${who})`, ext);
  const here = items.filter((i) => i.state === 'live' && !i.room && !i.dir && i.folder === folder);
  const at = (n: string) => here.find((i) => i.name === n);
  const p = at(plain);
  if (p?.mine) return { name: plain, folder, replace: p.id };
  if (!p) return { name: plain, folder, replace: null };
  const mine = at(named);
  return { name: named, folder, replace: mine?.mine ? mine.id : null };
}

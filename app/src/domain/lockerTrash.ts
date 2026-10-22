// 보관함 휴지통 확인(2026-10-12 사고 — 스크린샷 연결이 바탕화면을 가리킨 채 ⌘A → 휴지통으로 폴더 93개가 1초 만에 갔다).
// Rust locker_trash::plan 이 센 것으로 실제 규모를 보이고 단추를 고른다. 폴더가 섞이면 기본은 '파일만', 안에 든 것이 있는 폴더는
// 같이 휴지통 / 위 폴더로 꺼내기 / 다른 폴더로 옮기기(보관함 폴더만). 빈 폴더(숨은 파일만)는 묻지 않는다. 시험: lockerTrash.test.ts
import { tr } from '../i18n';

/** Rust locker_trash::Plan */
export type TrashPlan = {
  files: number; dirs: number; empties: number;
  /** 안에 든 것이 있는 폴더들 안의 항목 — 보관함 폴더 카드 숫자와 같은 기준(하위 폴더까지 파일·바로가기, 숨은 것 빼고) */
  inside: number;
  more: boolean;
  blocked: { rel: string; why: string }[];
  file_rels: string[]; dir_rels: string[]; empty_rels: string[];
  /** 꺼내기·옮기기가 되나(모두 보관함 폴더) */
  lift_ok: boolean;
};

export type TrashChoiceKey = 'all' | 'files' | 'with' | 'lift' | 'moveOut';
/** 단추 하나 — rels 를 foldersOk 로 휴지통(all·files·with), 또는 폴더 안의 것을 꺼내고(lift)·옮기고(moveOut) 폴더만 */
export type TrashChoice = { key: TrashChoiceKey; label: string; rels: string[]; foldersOk?: boolean; pri?: boolean };
export type TrashAsk = { text: string; blocked: string | null; choices: TrashChoice[]; /** 묻지 않고 바로(빈 폴더만) */ direct: boolean };

const n = (x: number) => x.toLocaleString('en-US');
const nameOf = (rel = '') => rel.slice(rel.lastIndexOf('/') + 1);

/** outside = 같이 골랐지만 보관함 밖이라 보내지 않는 것(기록 목록의 보여 준 프로젝트 파일) — 그 수도 알린다 */
export function trashAsk(p: TrashPlan, outside = 0): TrashAsk {
  const blocked = [
    p.blocked.length ? tr(`못 지우는 것 ${p.blocked.length}개는 뺐어`, `${p.blocked.length} protected item(s) left out`) : '',
    outside ? tr(`보관함 밖 ${outside}개는 그대로 둬`, `${outside} outside the locker stay as they are`) : '',
  ].filter(Boolean).join(' · ') || null;
  const light = [...p.file_rels, ...p.empty_rels];
  const insideTxt = p.more ? tr(`${n(p.inside)}개 넘게`, `over ${n(p.inside)}`) : tr(`${n(p.inside)}개`, `${n(p.inside)}`);
  if (p.dirs === 0) {
    const direct = p.files === 0 && p.empties > 0 && !p.blocked.length && !outside;
    const parts = [p.files ? tr(`파일 ${p.files}개`, `${p.files} file(s)`) : '', p.empties ? tr(`빈 폴더 ${p.empties}개`, `${p.empties} empty folder(s)`) : ''].filter(Boolean);
    const choices: TrashChoice[] = light.length ? [{ key: 'all', label: tr(`${light.length}개를 휴지통으로`, `Move ${light.length} to Trash`), rels: light, pri: true }] : [];
    return { text: parts.join(', ') || tr('지울 수 있는 게 없어', 'Nothing can be removed'), blocked, choices, direct };
  }
  const one = p.dirs === 1 && light.length === 0;
  const text = one
    ? tr(`${nameOf(p.dir_rels[0])} (안에 ${insideTxt})`, `${nameOf(p.dir_rels[0])} (${insideTxt} inside)`)
    : [
      p.files ? tr(`파일 ${p.files}개`, `${p.files} file(s)`) : '',
      tr(`폴더 ${p.dirs}개(안에 든 항목 ${insideTxt})`, `${p.dirs} folder(s) (${insideTxt} items inside)`),
      p.empties ? tr(`빈 폴더 ${p.empties}개`, `${p.empties} empty folder(s)`) : '',
    ].filter(Boolean).join(', ');
  const choices: TrashChoice[] = [];
  if (light.length) choices.push({ key: 'files', label: p.empties ? tr('파일·빈 폴더만 휴지통으로', 'Trash files and empty folders only') : tr('파일만 휴지통으로', 'Trash files only'), rels: light, pri: true });
  choices.push({ key: 'with', label: one ? tr('안의 것도 같이 휴지통으로', 'Trash it with everything inside') : tr('폴더까지 같이 휴지통으로', 'Trash folders too'), rels: [...light, ...p.dir_rels], foldersOk: true });
  if (p.lift_ok) {
    choices.push({ key: 'lift', label: tr('안의 것은 위 폴더로 꺼내고 폴더만 지우기', 'Move contents up, trash the folder only'), rels: [...light, ...p.dir_rels] });
    choices.push({ key: 'moveOut', label: tr('다른 폴더로 옮기고 폴더만 지우기', 'Move contents to another folder, trash the folder only'), rels: [...light, ...p.dir_rels] });
  }
  return { text, blocked, choices, direct: false };
}

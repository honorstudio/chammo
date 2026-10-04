// 열어 둔 문서를 밖(참모·세션)이 고치면 편집기에 받는다 — 노션처럼. 1.5초마다(창에 돌아올 때도) 파일 도장을 보고,
// 바뀌었으면 블록 단위로 합친다(domain/docMerge): 내가 안 건드린 블록의 바깥 변경은 들어오고, 같은 블록을 둘 다 고쳤으면
// 저장을 멈추고 '충돌' — 사람이 고른다(내 판으로 저장 / 바깥 판 불러오기, 어느 쪽이든 진 판은 history 에 남는다).
// 예전엔 처음 읽은 판을 통째로 저장해 밖에서 고친 줄이 말없이 사라졌다(2026-10-04 QA D1)
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { diffBlocks, merge3 } from '../../domain/docMerge';
import { lastSaved, newSession, saveNow, saveSoon, setBase, type DocSession } from './docSave';
import { absorbOutside } from './pending';
import { parseMd, writeMd } from './mdPipeline';

export type SyncState = 'ok' | 'conflict' | 'gone';
const EVERY = 1500;

type Ed = BlockNoteEditor;
type Blocks = Ed['document'];

export function useDocSync(editor: Ed, path: string, md: string) {
  const s = useRef<DocSession>(null as unknown as DocSession);
  if (!s.current) s.current = newSession(path, md);
  const ready = useRef(false);
  const busy = useRef(false);
  /** 편집기가 스스로 바꾸는 중 — 그 바뀜 알림은 사람이 친 게 아니다(저장·보낼 것에 안 넣는다) */
  const quiet = useRef(false);
  const theirs = useRef<{ text: string; stamp: string } | null>(null);
  /** 편집기 바뀜 횟수(SpaceEditor 가 알림마다 올린다) — 합치는 사이 사람이 쳤나 */
  const edits = useRef(0);
  const [state, setState] = useState<SyncState>('ok');
  const gone = useRef(false);

  const parse = (t: string) => parseMd(editor, t);
  const ser = (bs: Blocks) => Promise.all(bs.map((b) => Promise.resolve(editor.blocksToMarkdownLossy([b]))));
  /** 지금 편집기 → 파일에 쓸 md(mdPipeline — 원래 글 모양을 지킨다) */
  const normalize = () => writeMd(editor, s.current.base.text);

  /** 블록 바꾸기 — 편집기가 스스로(바뀜 알림이 저장으로 안 가게) */
  const apply = async (fn: () => void) => {
    quiet.current = true;
    try { editor.transact(fn); } finally { window.setTimeout(() => { quiet.current = false; }, 0); } // 알림 처리가 다 돈 뒤 푼다
  };

  const absorb = async (text: string, stamp: string) => {
    const ses = s.current;
    const ver = ses.base.ver;
    const seen = edits.current;
    const mineB = editor.document;
    const [bB, tB] = await Promise.all([parse(ses.base.text), parse(text)]);
    const [bS, mS, tS] = await Promise.all([ser(bB), ser(mineB), ser(tB)]);
    // 그새 저장했거나 사람이 쳤으면 다음 감시에서 다시(낡은 판으로 합치지 않는다)
    if (ses.base.ver !== ver || ses.writing || edits.current !== seen) return;
    const r = merge3(bS, mS, tS);
    if ('conflict' in r) {
      ses.blocked = true;
      theirs.current = { text, stamp };
      setState('conflict');
      return;
    }
    const mine = diffBlocks(bS, mS).length > 0;
    const before = await normalize();
    await apply(() => {
      for (const o of r.ops) {
        const doc = editor.document;
        const add = tB.slice(o.ts, o.te) as PartialBlock[];
        const old = doc.slice(o.at, o.at + o.del);
        if (old.length && old.length === doc.length && !add.length) editor.replaceBlocks(old, [{ type: 'paragraph' }]); // 다 지움 — 빈 줄 하나는 남는다
        else if (old.length) { if (add.length) editor.replaceBlocks(old, add); else editor.removeBlocks(old); }
        else if (add.length) { const at = doc[o.at - 1]; if (at) editor.insertBlocks(add, at, 'after'); else editor.insertBlocks(add, doc[0]!, 'before'); }
      }
    });
    setBase(ses, text, stamp);
    // 쓸 글은 기준을 바깥 판으로 바꾼 뒤에 — 들어온 블록이 바깥 판 원래 글 그대로 남는다(먼저 만들면 BlockNote 모양으로 다시 써졌다)
    const out = await normalize();
    absorbOutside(path, before, out);
    if (mine) saveSoon(ses, out); // 합친 판(내 것 + 바깥 것)을 바깥 판 기준으로 쓴다
    else lastSaved.set(path, out); // 바깥 판만 들어왔다 — 다시 쓰지 않는다(파일 모양을 편집기 모양으로 바꾸지 않게)
    setState('ok');
  };

  const tick = async () => {
    const ses = s.current;
    if (!ready.current || busy.current || ses.writing) return;
    busy.current = true;
    try {
      const ver = ses.base.ver;
      let stamp: string;
      try { stamp = await invoke<string>('doc_stamp', { path }); } catch { gone.current = true; setState((x) => (x === 'conflict' ? x : 'gone')); return; }
      if (gone.current) {
        // 파일이 돌아왔다(이름 되돌림·되살림) — 없던 동안 못 쓴 내 판을 다시 저장한다(아래 합치기·기준 비교를 거쳐)
        gone.current = false;
        setState((x) => (x === 'gone' ? 'ok' : x));
        const out = await normalize();
        if (lastSaved.get(path) !== out) { saveSoon(ses, out); return; }
      }
      if (ses.blocked ? stamp === theirs.current?.stamp : stamp === ses.base.stamp) return;
      const text = await invoke<string>('read_doc_text', { path }).catch(() => null);
      if (text == null || ses.base.ver !== ver || ses.writing) return;
      if (ses.blocked) { theirs.current = { text, stamp }; return; } // 충돌 중 — 고를 때 최신 바깥 판으로
      if (text === ses.base.text) { setBase(ses, text, stamp); return; }
      await absorb(text, stamp);
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    const ses = s.current;
    ses.onOutside = () => void tick();
    ses.onGone = () => { gone.current = true; setState('gone'); };
    const t = window.setInterval(() => void tick(), EVERY);
    const focus = () => void tick();
    window.addEventListener('focus', focus);
    return () => { ses.onOutside = undefined; ses.onGone = undefined; window.clearInterval(t); window.removeEventListener('focus', focus); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    session: s.current,
    state,
    quiet,
    edits,
    /** 처음 읽어 들인 뒤 — 감시 시작 */
    start: () => { ready.current = true; void tick(); },
    normalize,
    /** 충돌: 내 판으로 저장 — 바깥 판은 history 에 먼저 남긴다 */
    keepMine: async () => {
      const ses = s.current, t = theirs.current;
      if (!t) return;
      // 덮일 바깥 판을 먼저 남긴다 — Rust 의 '덮기 전 판'은 분마다 하나라 같은 분에 앞서 저장했으면 빠졌다(2026-10-04 실측)
      await invoke('keep_doc_version', { path, text: t.text, tag: 'outside' }).catch(() => {});
      ses.blocked = false;
      setBase(ses, t.text, t.stamp);
      theirs.current = null;
      setState('ok');
      await saveNow(ses, await normalize());
    },
    /** 충돌: 바깥 판 불러오기 — 내가 친 판은 history 에 먼저 남긴다 */
    takeTheirs: async () => {
      const ses = s.current, t = theirs.current;
      if (!t) return;
      const mine = await normalize();
      await invoke('keep_doc_version', { path, text: mine }).catch(() => {});
      const tB = await parse(t.text);
      await apply(() => editor.replaceBlocks(editor.document, tB.length ? (tB as PartialBlock[]) : [{ type: 'paragraph' }]));
      setBase(ses, t.text, t.stamp);
      const out = await normalize(); // 바깥 판 기준으로 — 바깥 판 글 그대로
      lastSaved.set(path, out);
      absorbOutside(path, mine, out);
      ses.blocked = false;
      theirs.current = null;
      setState('ok');
    },
  };
}

// 메모 한 장(시안 v2 K·P·W) — 패널에 쌓이는 카드와 따로 창이 같이 쓴다. 바탕은 그 메모 스킨, 머리엔 익숙한 동작 아이콘만.
// 편집기는 문서 페이지 그대로(personal — 보내기 단추·보낼 것·space-log 없이). 참모에게 가는 길은 보내기 아이콘(글 통째)과 ⋯ '보여 주기'(파일 참조)뿐
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { notesMeta, notesReveal, notesTrash, notesWindowDouble, notesWindowDrag } from '../../data/tauri';
import { notePaste, noteTitle, type NoteRow, type NoteSkin } from '../../domain/notes';
import { assistant, josa, tr } from '../../i18n';
import { IconChatSend, IconClose, IconMore } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { closeOnOutside } from '../outsideClose';
import { DocPage } from '../space/DocPage';
import { latestMd, readOutside } from '../space/docSave';
import { SkinPick } from './SkinPick';

type Give = (x: string) => boolean | Promise<boolean>;
type Props = {
  row: NoteRow;
  /** 메타가 바뀌었다(스킨·띄움) — 고친 줄을 받아 목록에 넣는다. null = 휴지통으로 갔다 */
  onRow: (r: NoteRow | null, was: NoteRow) => void;
  onShare: Give;
  onPaste: Give;
  /** 알림 한 줄(패널·창 아래) */
  tell: (m: string) => void;
  /** 머리 끝 단추 — 패널: 내리기, 창: 항상 위·패널로(빨간 신호등이 내리기) */
  head?: ReactNode;
  /** ⋯ 메뉴 맨 위 자리 옮기기 줄 — 패널: 따로 창으로, 창: 없음 */
  move?: { label: string; run: () => void };
  /** 창은 카드가 창을 꽉 채운다 */
  full?: boolean;
};

const onButton = (e: MouseEvent<HTMLElement>) => !!(e.target as Element).closest('button');

export function NoteCard({ row, onRow, onShare, onPaste, tell, head, move, full }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = closeOnOutside(window, (t) => !!box.current?.contains(t as Node), () => setOpen(false));
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', esc, true);
    return () => { off(); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  const fail = (what: string) => (e: unknown) => tell(`${what} ${String(e)}`);
  /** ⋯ 메뉴 줄 — 누르면 메뉴를 닫고 한다 */
  const menu = (run: () => void) => { setOpen(false); run(); };
  const skin = (s: NoteSkin) => void notesMeta(row.name, { skin: s }).then((r) => onRow(r, row)).catch(fail(tr('스킨을 못 바꿨어요:', "Couldn't change the skin:")));
  /** 머리 보내기 아이콘 — 방금 친 글(저장 전)까지, 없으면 파일에서 */
  const paste = async () => {
    const file = latestMd.has(row.path) ? null : await readOutside(row.path);
    const text = notePaste(latestMd.get(row.path) ?? (file && 'text' in file ? file.text : ''));
    if (!text) { tell(tr('메모가 비었어요', 'This note is empty')); return; }
    const ok = await Promise.resolve(onPaste(text)).catch(() => false);
    tell(ok
      ? tr(`${assistant()} 입력칸에 넣었어요`, `Added to the ${assistant()} input`)
      : tr(`넣을 채팅이 없어요. 채팅에서 ${josa(assistant(), '을', '를')} 먼저 골라요`, 'No chat to add this to. Pick an assistant in Chat first'));
  };
  const share = () => {
    void Promise.resolve(onShare(row.path)).then((ok) => tell(ok
      ? tr(`${assistant()} 입력칸에 넣었어요`, `Added to the ${assistant()} input`)
      : tr(`보여 줄 채팅이 없어요. 채팅에서 ${josa(assistant(), '을', '를')} 먼저 골라요`, 'No chat to show this to. Pick an assistant in Chat first')));
  };
  const reveal = () => void notesReveal(row.name).catch(() => {});
  const trash = () => void notesTrash(row.name).then(() => onRow(null, row)).catch(fail(tr('휴지통으로 못 옮겼어요:', "Couldn't move to Trash:")));
  /** 따로 창 머리 — 끌면 창이 옮겨지고, 더블클릭은 맥 설정대로(확대·최소화·안 함). 단추 자리만 빼고, 글 커서는 그대로 둔다 */
  const dbl = useRef<[number, number] | null>(null);
  const downHead = (e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || onButton(e)) return;
    if (e.detail === 2) { dbl.current = [e.clientX, e.clientY]; return; } // 맥처럼 두 번째 누름을 뗄 때 한다(끌면 취소)
    if (e.detail !== 1) return;
    e.preventDefault();
    void notesWindowDrag().catch(() => {});
  };
  const upHead = (e: MouseEvent<HTMLElement>) => {
    const a = dbl.current;
    dbl.current = null;
    if (e.button !== 0 || e.detail !== 2 || !a || a[0] !== e.clientX || a[1] !== e.clientY || onButton(e)) return;
    void notesWindowDouble().catch(() => {});
  };
  return (
    <article ref={box} className={`nt-card nt-sk sk-${row.skin}${full ? ' nt-full' : ''}`} data-note={row.name} aria-label={noteTitle(row, tr('새 메모', 'New note'))}>
      <header className="nt-ch" onMouseDown={full ? downHead : undefined} onMouseUp={full ? upHead : undefined}>
        <span className="nt-sp" />
        <IconButton label={tr(`${assistant()} 입력칸에 넣기`, `Add to ${assistant()} input`)} onClick={() => void paste()}><IconChatSend /></IconButton>
        <IconButton label={tr('더보기', 'More')} pressed={open} onClick={() => setOpen(!open)}><IconMore /></IconButton>
        {head}
      </header>
      {open && (
        <div className="nt-pop nt-more" role="menu" aria-label={tr('더보기', 'More')}>
          <div className="nt-skrow"><span>{tr('스킨', 'Skin')}</span><SkinPick value={row.skin} onPick={(s) => menu(() => skin(s))} /></div>
          <i className="nt-line" />
          {move && <button role="menuitem" className="nt-row" onClick={() => menu(move.run)}><span>{move.label}</span></button>}
          <button role="menuitem" className="nt-row" onClick={() => menu(share)}><span>{tr(`${assistant()}에게 보여 주기`, `Show to ${assistant()}`)}</span></button>
          <button role="menuitem" className="nt-row" onClick={() => menu(reveal)}><span>{tr('파인더에서 보기', 'Show in Finder')}</span></button>
          <i className="nt-line" />
          <button role="menuitem" className="nt-row warn" onClick={() => menu(trash)}><span>{tr('휴지통으로', 'Move to Trash')}</span></button>
        </div>
      )}
      <div className="nt-doc">
        <DocPage key={row.path} personal path={row.path} owner="" title={noteTitle(row, '')} />
      </div>
    </article>
  );
}

/** 패널 카드 머리 끝 — 내리기(×) */
export function HideButton({ row, onRow, tell }: Pick<Props, 'row' | 'onRow' | 'tell'>) {
  const hide = () => void notesMeta(row.name, { shown: false, win: false }).then((r) => { onRow(r, row); tell(tr('내렸어요. 목록에서 다시 띄워요', 'Unpinned. Pin it again from the list')); }).catch(() => {});
  return <IconButton label={tr('내리기', 'Unpin')} onClick={hide}><IconClose /></IconButton>;
}

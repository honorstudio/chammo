// 답을 기다림 카드 물음 — 첫 줄(물음)만 굵게, 나머지는 줄 그대로 흐린 본문. 길면 앞 3줄만(줄마다 한 줄로 자름) + 펼침 화살표.
// '답: A / B' 줄은 알약(WaitReply)이 대신하니 여기선 안 그린다 — 알약으로 못 만든 줄이면 본문에 남는다(domain/askNote)
import { useState } from 'react';
import { askNote, foldNote } from '../../domain/askNote';
import { IconChevron } from '../Icons';

export function WaitNote({ q }: { q: string }) {
  const [open, setOpen] = useState(false);
  const n = askNote(q);
  const f = foldNote(n, open);
  return (
    <div className={`m-wnote${open ? ' open' : ''}`}>
      <div className="m-ask-q">{n.head}</div>
      {f.body.length > 0 && <div className="m-wnote-body">{f.body.map((l, i) => <div key={i}>{l}</div>)}</div>}
      {f.more && (
        <button type="button" className="m-ask-more" aria-expanded={open} aria-label={open ? '접기' : '더 보기'} title={open ? '접기' : '더 보기'} onClick={() => setOpen(!open)}>
          <IconChevron />
        </button>
      )}
    </div>
  );
}

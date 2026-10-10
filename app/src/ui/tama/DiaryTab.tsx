// 펫 모달 '일기' 탭 — 새벽 5시마다 쓰인 한 장을 넘겨 본다(docs/design-drafts/tama-next v1 A). 글은 domain/tama/diary.renderDiary
import { useState } from 'react';
import { renderDiary, type DiaryDay } from '../../domain/tama/diary';
import { nameOf } from '../../domain/tama/tree';
import { tr } from '../../i18n';
import { IconNext, IconPrev } from '../Icons';
import { spriteOf } from './lcd';
import { Sprite } from './Sprite';

export function DiaryTab({ diary }: { diary: DiaryDay[] }) {
  const [at, setAt] = useState<number | null>(null); // null = 맨 마지막 장
  if (!diary.length) return <div className="pv-blank">{tr('아직 일기가 없어 — 새벽 5시에 하루를 마치면 그날 먹은 걸로 한 장 써', 'No diary yet — at 5 a.m. it writes a page about what it ate that day')}</div>;
  const i = Math.min(at ?? diary.length - 1, diary.length - 1);
  const d = diary[i]!;
  const page = renderDiary(d);
  return (
    <div className="pv-diary">
      <div className="pv-diary-nav">
        <button className="pv-ic" disabled={i === 0} onClick={() => setAt(i - 1)} aria-label={tr('앞 장', 'Previous page')} title={tr('앞 장', 'Previous page')}><IconPrev /></button>
        <span>{i + 1} / {diary.length}</span>
        <button className="pv-ic" disabled={i === diary.length - 1} onClick={() => setAt(i + 1)} aria-label={tr('다음 장', 'Next page')} title={tr('다음 장', 'Next page')}><IconNext /></button>
      </div>
      <article className="pv-page">
        <header>
          <Sprite name={spriteOf(d.egg, d.slot)} size={36} />
          <div className="pv-name"><b>{page.date}</b><span>{page.weather} · {tr(`${d.gen}대 ${nameOf(d.egg, d.slot)}`, `Gen ${d.gen} ${nameOf(d.egg, d.slot)}`)}</span></div>
        </header>
        {page.lines.map((l, k) => <p key={k}>{l}</p>)}
      </article>
    </div>
  );
}

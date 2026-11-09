// 폰 알림 시트 '답 기다림' — 데스크톱 결정 대기함처럼 한 장씩(시안 docs/design-drafts/inbox-today V2P, 2026-11-05 사용자).
// 차례·누름 막기는 데스크톱과 같은 훅(useDeck). 카드 안 모양(결제 카드·기다림 카드)은 그대로
import type { ReactNode } from 'react';
import type { DeckPage } from '../../domain/inboxDeck';
import { tr } from '../../i18n';
import { IconNext, IconPrev } from '../Icons';
import { useDeck } from '../useDeck';
import { IconBtn } from './kit';

export type WaitPage = DeckPage & { node: ReactNode };

export function WaitPager({ pages }: { pages: WaitPage[] }) {
  const { deck, at, cur, go, arming } = useDeck(pages);
  if (!cur) return null;
  return (
    <div className="m-pg" role="group" aria-label={tr(`결정 대기 ${at + 1} / ${deck.length}`, `Decision ${at + 1} of ${deck.length}`)}>
      <div key={cur.key} className={`m-pg-page${arming ? ' arming' : ''}`}>{cur.node}</div>
      {deck.length > 1 && (
        <div className="m-pg-foot">
          <span className="m-pg-more">{tr(`${deck.length - 1}개 더`, `${deck.length - 1} more`)}</span>
          <IconBtn label={tr('이전 물음', 'Previous')} onClick={() => go(-1)}><IconPrev /></IconBtn>
          <IconBtn label={tr('다음 물음', 'Next')} onClick={() => go(1)}><IconNext /></IconBtn>
        </div>
      )}
    </div>
  );
}

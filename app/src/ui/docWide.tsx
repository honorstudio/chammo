// md 문서 넓게/좁게 — 값은 domain/docWidth 한 벌을 스페이스 문서(DocPage)·리더 md 가 같이 구독한다
import { useSyncExternalStore } from 'react';
import { docWideStore } from '../domain/docWidth';
import { tr } from '../i18n';
import { IconWidthNarrow, IconWidthWide } from './Icons';
import { IconButton } from './kit/IconButton';

const store = docWideStore((() => { try { return window.localStorage; } catch { return undefined; } })());

export const useDocWide = (): boolean => useSyncExternalStore(store.subscribe, store.get);

/** 문서 머리 토글 — 아이콘은 누르면 될 모양(넓게일 땐 좁게 아이콘) */
export function DocWidthButton({ className, size }: { className?: string; size?: 's' | 'm' }) {
  const wide = useDocWide();
  return (
    <IconButton className={className} size={size}
      label={wide ? tr('좁게 보기', 'Narrow view') : tr('넓게 보기', 'Wide view')}
      title={wide ? tr('좁게 보기 — 글을 가운데 좁은 폭으로', 'Narrow view — text in a narrow centered column') : tr('넓게 보기 — 창 폭에 맞춰 넓게', 'Wide view — text fills the window width')}
      onClick={store.toggle}>
      {wide ? <IconWidthNarrow /> : <IconWidthWide />}
    </IconButton>
  );
}

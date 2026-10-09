// 파일 썸네일 — 대시보드 '주고받은 파일' 카드와 채팅 안 파일 카드가 같이 쓴다(OrchDash 에서 떼어 옴)
import { useEffect, useState } from 'react';
import { readFileText } from '../../data/web';
import { textHead, webParts } from '../../domain/phoneFile';
import { useBlobUrl } from './useBlobUrl';
import { remember, remembered } from './memo';

export const isImage = (p: string) => p.startsWith('data:image/') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(p);

/** 썸네일 종류 — 그림은 sips, PDF·HTML 시안·오피스·영상은 맥 QuickLook 첫 장, 글(md·txt)은 앞부분을 글로 */
const QL = /\.(pdf|html?|pptx?|key|docx?|pages|xlsx?|numbers|mp4|mov|m4v)$/i;
const TEXT = /\.(md|markdown|txt|log|json|csv|tsv|ya?ml|toml|tsx?|jsx?|mjs|py|rs|sh|swift|kt|css|sql)$/i;
const CODE = /\.(json|csv|tsv|ya?ml|toml|tsx?|jsx?|mjs|py|rs|sh|swift|kt|css|sql|log)$/i;

/** 글 파일 앞부분 — 한 번 읽은 건 기억(화면을 오가도 다시 안 받게) */
function useTextHead(path: string | null, code = false): string | null {
  const key = path ? `head:${code ? 'c' : 't'}:${path}` : '';
  const [t, setT] = useState<string | null>(() => (key ? remembered<string>(key) ?? null : null));
  useEffect(() => {
    if (!path || remembered(key) !== undefined) return;
    let alive = true;
    readFileText(path).then((x) => {
      const head = textHead(x, code);
      remember(key, head);
      if (alive) setT(head);
    }, () => {});
    return () => { alive = false; };
  }, [path, key, code]);
  return t;
}

/** 썸네일 칸 하나(.m-thumb) — 크기는 감싼 카드 CSS 가 정한다. 웹 주소는 도메인 글 */
export function FileThumb({ path, big }: { path: string; big?: boolean }) {
  const web = /^https?:\/\//i.test(path) ? webParts(path) : null;
  const img = !web && isImage(path);
  const ql = !web && !img && QL.test(path);
  const text = !web && !img && !ql && TEXT.test(path);
  // 큰 카드 720·작은 카드 360(2배 화면) — 화면 크기에 맞는 것만 받는다
  const src = useBlobUrl(img || ql ? path : null, true, big ? 720 : 360);
  const head = useTextHead(text ? path : null, CODE.test(path));
  if (web) return <span className="m-thumb m-thumb-web"><b>{web.host}</b>{web.rest && <span>{web.rest}</span>}</span>;
  const ext = path.split('.').pop()?.toUpperCase() ?? '';
  return (
    <span className={text ? `m-thumb m-thumb-text${CODE.test(path) ? ' m-thumb-code' : ''}` : ql ? 'm-thumb m-thumb-doc' : 'm-thumb'}>
      {src ? <img src={src} alt="" /> : text && head ? <span className="m-head">{head}</span> : <span className="m-ext">{ext}</span>}
      {ql && src && <span className="m-ext-tag">{ext}</span>}
    </span>
  );
}

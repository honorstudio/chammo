// 파일 길(/api/file)의 그림을 토큰 실어 받아 blob 주소로 — <img src> 는 Authorization 을 못 싣는다. data: 주소는 그대로.
// 한 번 받은 그림은 기억해 두고(가장 오래 안 쓴 것부터 80개 넘으면 놓는다) 화면을 오가도 다시 안 받는다(2026-10-03 사용자 '한 박자 뒤')
import { useEffect, useState } from 'react';
import { fileBlobUrl, type ThumbSize } from '../../data/web';
import { BlobMemo } from './memo';
import { shared } from '../../domain/inflight';

const memo = new BlobMemo(80, (u) => URL.revokeObjectURL(u));

/** 미리 받기 — 폰 첫 화면 스플래시 동안 첫 카드 썸네일을 기억에 넣어 둔다 */
export async function warmBlob(path: string, thumb: boolean, size?: ThumbSize): Promise<void> {
  const key = `${path}|${thumb ? `t${size ?? ''}` : 'f'}`;
  if (memo.get(key)) return;
  memo.put(key, await shared(`blob:${key}`, () => fileBlobUrl(path, thumb, size)));
}

export function useBlobUrl(path: string | null, thumb = false, size?: ThumbSize): string | null {
  const key = path ? `${path}|${thumb ? `t${size ?? ''}` : 'f'}` : '';
  const [url, setUrl] = useState<string | null>(() => (path?.startsWith('data:') ? path : key ? memo.get(key) ?? null : null));
  useEffect(() => {
    if (!path || path.startsWith('data:')) {
      setUrl(path);
      return;
    }
    const hit = memo.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let alive = true;
    shared(`blob:${key}`, () => fileBlobUrl(path, thumb, size)).then((u) => { memo.put(key, u); if (alive) setUrl(u); }, () => alive && setUrl(null));
    return () => { alive = false; };
  }, [path, thumb, size, key]);
  return url;
}

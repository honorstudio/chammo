// 폰 파일 받기 단추 — 파일 보기 머리에. 받기 표(/api/dl)로 원본을 받아 iOS 공유 시트로(파일 앱·사진·카톡), 크거나 공유 시트가 못 받으면 내려받기 링크로.
// 사파리는 공유 시트를 누른 직후에만 띄워 줘서, 받는 동안 그 순간이 지나 거절되면(NotAllowedError) 받은 파일을 들고 '다시 누르기'로 둔다
import { useRef, useState } from 'react';
import { dlTicket } from '../../data/web';
import { fileType, sharePlan } from '../../domain/phoneShare';
import { IconShare } from '../Icons';
import { tr } from '../../i18n';

type St = { k: 'idle' } | { k: 'busy'; pct: number | null } | { k: 'ready' } | { k: 'fail'; why: string };

async function fetchFile(url: string, name: string, mime: string, size: number, onPct: (p: number) => void): Promise<File> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 403 ? tr('폰에 내보낼 수 없는 파일이에요', "This file can't be sent to the phone") : r.status === 413 ? tr('너무 커요', 'Too large') : tr(`못 받았어요(${r.status})`, `Download failed (${r.status})`));
  const parts: BlobPart[] = [];
  const rd = r.body?.getReader();
  if (rd) {
    let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (size > 0) onPct(Math.min(99, Math.round((got / size) * 100)));
    }
  } else parts.push(await r.blob());
  return new File(parts, name, { type: fileType(mime) });
}

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** cls = 단추 모양(그림 보기는 어두운 머리라 m-icon m-iv-x) */
export function ShareButton({ path, cls = 'm-rt-btn m-ico' }: { path: string; cls?: string }) {
  const [st, setSt] = useState<St>({ k: 'idle' });
  const ready = useRef<File | null>(null);
  const share = async (f: File) => {
    try {
      await navigator.share({ files: [f] });
      ready.current = null;
      setSt({ k: 'idle' });
    } catch (e) {
      const n = (e as Error).name;
      if (n === 'AbortError') { ready.current = null; setSt({ k: 'idle' }); return; } // 사람이 닫음
      if (n === 'NotAllowedError') { setSt({ k: 'ready' }); return; } // 누른 순간이 지남 — 받은 파일로 한 번 더
      setSt({ k: 'fail', why: tr('공유를 못 열었어요', "Couldn't open sharing") });
    }
  };
  const go = async () => {
    if (st.k === 'busy') return;
    if (ready.current) { void share(ready.current); return; }
    setSt({ k: 'busy', pct: null });
    try {
      const t = await dlTicket(path);
      const probe = new File([], t.name, { type: fileType(t.mime) });
      const can = typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [probe] });
      if (sharePlan(t.size, can) === 'download') { download(t.url, t.name); setSt({ k: 'idle' }); return; }
      const f = await fetchFile(t.url, t.name, t.mime, t.size, (pct) => setSt({ k: 'busy', pct }));
      ready.current = f;
      setSt({ k: 'idle' }); // 공유 시트가 뜨는 동안은 받는 중 글을 치운다
      await share(f);
    } catch (e) {
      setSt({ k: 'fail', why: (e as Error).message || tr('못 받았어요', 'Download failed') });
    }
  };
  const say = st.k === 'busy' ? tr(`받는 중${st.pct !== null ? ` ${st.pct}%` : '…'}`, `Downloading${st.pct !== null ? ` ${st.pct}%` : '…'}`) : st.k === 'ready' ? tr('받았어요 — 한 번 더 누르기', 'Got it — tap once more') : st.k === 'fail' ? st.why : '';
  return (
    <>
      {say && <span className={`m-share-st ${st.k}`} role="status">{say}</span>}
      <button type="button" className={cls} onClick={() => void go()} disabled={st.k === 'busy'} aria-label={tr('폰으로 받기', 'Save to phone')} title={tr('폰으로 받기', 'Save to phone')}><IconShare /></button>
    </>
  );
}

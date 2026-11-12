// 폰 파일 받기·공유 — 파일 보기 머리·팀 파일 길게 누르기 메뉴에 둘이 나란히(11-12 사용자 "공유 버튼은 있는데 다운로드 버튼이 없다").
// 받기 = 받기 표(/api/dl, 원본·attachment) 주소를 사파리 내려받기로 → 파일 앱 '다운로드'. 공유 = 원본을 받아 iOS 공유 시트(파일 앱·사진·카톡),
// 크거나 공유 시트가 못 받으면 내려받기. 사파리는 공유 시트를 누른 직후에만 띄워 줘서, 받는 동안 그 순간이 지나 거절되면(NotAllowedError)
// 받은 파일을 들고 '다시 누르기'로 둔다. 팀 파일은 암호문이라 맥이 받아 푸는 동안(/api/team-dl) 기다렸다 같은 받기 표로 받는다
import { useEffect, useRef, useState } from 'react';
import { dlTicket, teamDl } from '../../data/web';
import { dlErrorText, fileType, sharePlan, waitTeamDl, type DlTicket } from '../../domain/phoneShare';
import { IconDownload, IconShare } from '../Icons';
import { tr } from '../../i18n';

/** 무엇을 — 맥 파일(보여 준 것·보관함, path) 또는 팀 파일(팀 보관함·대화 파일, team) */
export type SaveSrc = { path?: string; team?: { team: string; id: string } };
type St = { k: 'idle' } | { k: 'busy'; pct: number | null } | { k: 'ready' } | { k: 'fail'; why: string };

/** 받기 표 — 팀 파일이면 맥이 받아 푸는 동안 % 를 알리며 기다린다 */
function ticketOf(src: SaveSrc, onPct: (p: number | null) => void, signal: AbortSignal): Promise<DlTicket> {
  const t = src.team;
  if (t) return waitTeamDl(() => teamDl(t.team, t.id), onPct, undefined, signal);
  return dlTicket(src.path!);
}

async function fetchFile(url: string, name: string, mime: string, size: number, onPct: (p: number) => void): Promise<File> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(dlErrorText(r.status === 413 ? 'too large' : r.status === 403 ? 'not allowed' : `${tr('못 받았어요', 'Download failed')}(${r.status})`));
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

/** 사파리 내려받기 — 받기 표 주소는 attachment 라 페이지를 떠나지 않고 파일 앱 '다운로드'로 */
function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 단추 하나의 상태 — 받는 동안 한 번만, 화면에서 빠지면(메뉴 닫힘) 팀 받기 묻기를 끊는다(맥은 받던 걸 마저 받아 둔다) */
function useSave() {
  const [st, setSt] = useState<St>({ k: 'idle' });
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  const run = async (job: (onPct: (p: number | null) => void, signal: AbortSignal) => Promise<St>) => {
    if (st.k === 'busy') return;
    const c = new AbortController();
    stop.current = c;
    setSt({ k: 'busy', pct: null });
    try {
      const next = await job((pct) => { if (!c.signal.aborted) setSt({ k: 'busy', pct }); }, c.signal);
      if (!c.signal.aborted) setSt(next);
    } catch (e) {
      if (!c.signal.aborted) setSt({ k: 'fail', why: dlErrorText((e as Error).message) });
    }
  };
  return { st, setSt, run };
}

function Status({ st }: { st: St }) {
  const say = st.k === 'busy' ? tr(`받는 중${st.pct !== null ? ` ${st.pct}%` : '…'}`, `Downloading${st.pct !== null ? ` ${st.pct}%` : '…'}`)
    : st.k === 'ready' ? tr('받았어요 — 한 번 더 누르기', 'Got it — tap once more')
      : st.k === 'fail' ? st.why : '';
  return say ? <span className={`m-share-st ${st.k}`} role="status">{say}</span> : null;
}

/** 받기 — 사파리 다운로드(파일 앱). cls = 단추 모양(그림 보기는 어두운 머리라 m-icon m-iv-x) */
export function DownloadButton({ path, team, cls = 'm-rt-btn m-ico' }: SaveSrc & { cls?: string }) {
  const { st, run } = useSave();
  const go = () => void run(async (onPct, signal) => {
    const t = await ticketOf({ path, team }, onPct, signal);
    download(t.url, t.name);
    return { k: 'idle' };
  });
  return (
    <>
      <Status st={st} />
      <button type="button" className={cls} onClick={go} disabled={st.k === 'busy'} aria-label={tr('받기', 'Download')} title={tr('받기', 'Download')}><IconDownload /></button>
    </>
  );
}

/** 공유 — 원본을 받아 iOS 공유 시트로(크거나 못 받는 브라우저면 내려받기) */
export function ShareButton({ path, team, cls = 'm-rt-btn m-ico' }: SaveSrc & { cls?: string }) {
  const { st, setSt, run } = useSave();
  const ready = useRef<File | null>(null);
  const share = async (f: File): Promise<St> => {
    try {
      await navigator.share({ files: [f] });
      ready.current = null;
      return { k: 'idle' };
    } catch (e) {
      const n = (e as Error).name;
      if (n === 'AbortError') { ready.current = null; return { k: 'idle' }; } // 사람이 닫음
      if (n === 'NotAllowedError') return { k: 'ready' }; // 누른 순간이 지남 — 받은 파일로 한 번 더
      return { k: 'fail', why: tr('공유를 못 열었어요', "Couldn't open sharing") };
    }
  };
  const go = () => {
    if (ready.current) { const f = ready.current; void share(f).then(setSt); return; }
    void run(async (onPct, signal) => {
      const t = await ticketOf({ path, team }, onPct, signal);
      const probe = new File([], t.name, { type: fileType(t.mime) });
      const can = typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [probe] });
      if (sharePlan(t.size, can) === 'download') { download(t.url, t.name); return { k: 'idle' }; }
      const f = await fetchFile(t.url, t.name, t.mime, t.size, onPct);
      ready.current = f;
      setSt({ k: 'idle' }); // 공유 시트가 뜨는 동안은 받는 중 글을 치운다
      return share(f);
    });
  };
  return (
    <>
      <Status st={st} />
      <button type="button" className={cls} onClick={go} disabled={st.k === 'busy'} aria-label={tr('공유', 'Share')} title={tr('공유', 'Share')}><IconShare /></button>
    </>
  );
}

/** 받기·공유 한 쌍 — 받기가 앞(더 자주 찾는 쪽), 공유가 뒤 */
export function SaveButtons(p: SaveSrc & { cls?: string }) {
  return (
    <>
      <DownloadButton {...p} />
      <ShareButton {...p} />
    </>
  );
}

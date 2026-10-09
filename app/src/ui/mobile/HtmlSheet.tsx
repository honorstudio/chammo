// 폰 html 시안 보기 — 표 주소(iframe sandbox allow-scripts, 같은 출처 아님)로 연다. 넓은 시안은 폰 폭에 맞춰 줄이고 두 손가락으로 키운다.
// 검토 시안(design·flow-curation 껍데기)이면 블록을 눌러 쓴다·애매·뺀다를 고르고, 표시는 맥 curation/ 에 바로 적히며, 위 보내기로 참모에게.
// (전략 표 6번, 2026-10-03 사용자 "큐레이션 폰에서 누르기 예 + curation/ 에 남김")
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { curationSave, curationState, htmlTicket, sendTextToSession } from '../../data/web';
import { emptyStore } from '../../domain/curation';
import { draftFit, pinchZoom } from '../../domain/htmlFit';
import { sendPreview } from '../../domain/sendPreview';
import { IconClose, IconSend } from '../Icons';
import { HTML_SANDBOX } from './htmlFrame';
import { fileError } from '../../domain/phoneFile';
import { machine } from '../../i18n';

type Cur = { title: string; total: number; done: number; text: string };
const why = (): Record<string, string> => ({ 'secret inside': `시안 속에 키가 보여서 폰엔 안 보여 줘요 — ${machine()}에서 열어 주세요`, 'not allowed': '폰에서 열 수 없는 시안이에요', 'file too large': `시안이 10MB 를 넘어 폰에선 못 열어요 — ${machine()}에서` });

export default function HtmlSheet({ path, title, orch, onClose }: { path: string; title: string; orch?: string; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<{ text: string; gone: boolean } | null>(null);
  const [boxW, setBoxW] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [cur, setCur] = useState<Cur | null>(null);
  const [z, setZ] = useState(1);
  const [live, setLive] = useState(1);
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'fail'>('idle');
  // 시안이 보내자고 한 글 — 사람이 미리보기를 보고 눌러야 보낸다(시안 안 글이 참모에게 바로 가면 프롬프트 주입 길)
  const [ask, setAsk] = useState<string | null>(null);

  useEffect(() => {
    htmlTicket(path).then((r) => setUrl(r.url), (e: unknown) => { const m = (e as Error).message; setErr(fileError(m, why())); });
  }, [path]);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const send = async (text: string) => {
    if (!orch) return false;
    setSent('sending');
    try { await sendTextToSession(orch, text, `${Date.now()}-cur`); setSent('sent'); return true; } catch { setSent('fail'); return false; }
  };
  const post = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(m, '*');

  // 시안이 알려 오는 것 — 우리 틀에서 온 것만
  const zRef = useRef(z);
  zRef.current = z;
  const liveRef = useRef(1);
  useEffect(() => {
    let checked = false;
    let ready = false; // 맥에 적힌 표시를 되돌려 보기 전엔 안 적는다(빈 표시가 좋은 기록을 덮지 않게)
    let saveT = 0;
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { hodoc?: string; w?: number; h?: number; k?: number; done?: boolean | number; total?: number; title?: string; text?: string; store?: Record<string, Record<string, unknown> | undefined> } | null;
      if (!d?.hodoc) return;
      if (d.hodoc === 'html-size' && d.w && d.h) setSize({ w: d.w, h: d.h });
      if (d.hodoc === 'html-pinch') {
        if (d.done === true) {
          const nz = pinchZoom(zRef.current, liveRef.current, 1, 4);
          liveRef.current = 1;
          setLive(1);
          setZ(nz);
          if (curRef.current) post({ hodoc: 'cur-cmd', cmd: 'zoom', z: nz });
        } else if (d.k && !curRef.current) { liveRef.current = d.k; setLive(d.k); }
        else if (d.k) liveRef.current = d.k;
      }
      if (d.hodoc === 'cur-state' && typeof d.text === 'string') {
        const c = { title: d.title ?? '', total: d.total ?? 0, done: typeof d.done === 'number' ? d.done : 0, text: d.text };
        curRef.current = c;
        setCur(c);
        setSent((x) => (x === 'sent' ? 'idle' : x));
        // 처음 알림이 비었으면 맥에 적어 둔 표시를 되돌린다(시안 저장소는 이 페이지 동안만) — 확인 전엔 안 적는다
        if (!checked) {
          checked = true;
          if (emptyStore(d.store)) {
            curationState(path).then((j) => { try { const data = JSON.parse(j) as Record<string, unknown>; if (!emptyStore(data as never)) post({ hodoc: 'cur-cmd', cmd: 'restore', data }); } catch { /* 없음 */ } }, () => {}).finally(() => { ready = true; });
            return;
          }
          ready = true;
        }
        if (!ready) return;
        window.clearTimeout(saveT);
        const text = d.text, store = d.store ?? {};
        saveT = window.setTimeout(() => void curationSave(path, text, store).catch(() => {}), 600);
      }
      // 껍데기 안 '참모에게 보내기' — 바로 안 보내고 폰 화면에서 묻는다. 답(curation-sent)은 사람이 고른 뒤에
      if (d.hodoc === 'curation' && typeof d.text === 'string' && orch) setAsk(d.text);
    };
    window.addEventListener('message', on);
    const ping = window.setTimeout(() => post({ hodoc: 'cur-cmd', cmd: 'ping' }), 900);
    return () => { window.removeEventListener('message', on); window.clearTimeout(ping); window.clearTimeout(saveT); };
  }, [path, url]); // eslint-disable-line react-hooks/exhaustive-deps
  const curRef = useRef<Cur | null>(null);

  // 그냥 시안: 넓으면 폰 폭에 맞춰 줄이고(z·핀치는 그 위에 곱), 높이는 시안 높이만큼 — 바깥 칸이 스크롤한다
  const fit = size && !cur ? draftFit(size.w, boxW) : 1;
  const k = fit * (cur ? 1 : z * live);
  const fw = cur || !size ? undefined : size.w;
  const fh = cur || !size ? undefined : size.h;
  return (
    <div className="m-view m-html" role="dialog" aria-label={title}>
      <div className="m-picker-head">
        <b className="m-view-title">{cur?.title || title}</b>
        {cur && <span className="m-pdf-no">{cur.done} / {cur.total}</span>}
        {cur && orch && (
          <button type="button" className={`m-rt-btn m-ico m-cur-send ${sent}`} disabled={sent === 'sending'} onClick={() => void send(cur.text)}
            aria-label={sent === 'sent' ? '참모에게 보냈어요' : '검토 결과 참모에게 보내기'} title={sent === 'sent' ? '보냈어요' : sent === 'fail' ? '못 보냄 — 다시 누르기' : '참모에게 보내기'}><IconSend /></button>
        )}
        <button type="button" className="m-rt-btn m-ico" onClick={onClose} aria-label="닫기" title="닫기"><IconClose /></button>
      </div>
      {ask !== null && (() => {
        const p = sendPreview(ask);
        const answer = (go: boolean) => {
          setAsk(null);
          if (!go) { post({ hodoc: 'curation-sent', ok: false, error: '취소했어요' }); return; }
          void send(ask).then((ok) => post({ hodoc: 'curation-sent', ok }));
        };
        return (
          <div className="m-confirm m-send-ask" role="alertdialog" aria-label="참모에게 보낼까요">
            <div>시안이 이 글을 참모에게 보내자고 해요 — 보낼까요? ({p.chars}자)</div>
            <pre className="m-send-peek">{p.lines.join('\n')}{p.more ? '\n…' : ''}</pre>
            <div className="m-new-row">
              <button type="button" className="m-btn" onClick={() => answer(false)}>취소</button>
              <button type="button" className="m-send" onClick={() => answer(true)}>보내기</button>
            </div>
          </div>
        );
      })()}
      <div className={cur ? 'm-html-body m-html-cur' : 'm-html-body'} ref={wrap}>
        {err && <p className={`${err.gone ? 'm-muted' : 'm-error'} m-pad`}>{err.text}</p>}
        {!url && !err && <p className="m-muted m-pad">여는 중…</p>}
        {url && (
          <div className="m-html-sizer" style={fw && fh ? { width: fw * k, height: fh * k } : undefined}>
            <iframe ref={frame} title={title} src={url} sandbox={HTML_SANDBOX}
              style={fw && fh ? { width: fw, height: fh, transform: `scale(${k})` } : undefined} />
          </div>
        )}
      </div>
    </div>
  );
}

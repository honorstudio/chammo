// 세션 브라우저 보기 — 평소엔 읽기만(2026-10-03). 화면이 보일 때만 맥에서 새 프레임을 묻는다(묻는 동안만 맥이 받는다).
// 폰은 데이터가 아까워서 일하는 중 0.7초·조용하면 2초마다. 화면을 누르면 바닥 전체를 덮어 크게 — 거기선 핀치로 확대(ZoomBox).
// 사람 개입(2026-10-06 사용자 ⑥) — '개입'을 누르면 그때부터 크게 보기에서 누르기·밀기(스크롤)·글자를 보내고, 세션은 브라우저 일을 멈춘다.
// '돌려주기'(세션이 부른 거면 '다 했어')를 누르면 세션이 사람이 한 일 꼬리표를 받고 이어 간다. 친 글은 어디에도 안 남긴다
// 화면을 못 받으면(크롬 꺼짐·붙기 실패·폰이 못 받음) 이유 한 줄 + 다시 시도(2026-10-09 — 예전엔 실패를 삼켜 '화면 받는 중'에 이유 없이 멈췄다)
import { useEffect, useRef, useState } from 'react';
import { browserFrame, browserInput, browserRetry, browserTakeover } from '../../data/web';
import { controlOf, phoneTrouble, takeoverLine, unpackFrame, type Live } from '../../domain/agentBrowser';
import { phoneGesture, phoneKey, pointIn, type InputEv } from '../../domain/agentInput';
import { IconBackspace, IconEnter, IconRefresh, IconSend } from '../Icons';
import { ZoomBox } from './ZoomBox';

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export function BrowserView({ live }: { live: Live }) {
  const [src, setSrc] = useState('');
  const [big, setBig] = useState(false);
  const [err, setErr] = useState('');
  // 폰이 프레임을 못 받은 이유 — 받으면 지운다
  const [pullErr, setPullErr] = useState('');
  // 누르면 목록(5초)을 기다리지 않고 바로 바뀐 것으로 본다 — 목록이 따라오면 지운다
  const [want, setWant] = useState<boolean | null>(null);
  const liveMine = !!live.takeover;
  useEffect(() => { if (want !== null && want === liveMine) setWant(null); }, [liveMine, want]);
  const ctl = controlOf({ ...live, takeover: (want ?? liveMine) ? live.takeover ?? { by: 'phone', at: Date.now() } : null });
  const seq = useRef(0);
  const url = useRef('');
  // 조작하는 동안은 눌러 본 결과가 빨리 보이게 0.3초, 일하는 중 0.7초, 조용하면 2초
  const every = useRef(2000);
  every.current = big && ctl !== 'view' ? 300 : live.busy ? 700 : 2000;
  // 다시 시도 — 기다리지 않고 바로 한 번 묻는다
  const pullNow = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    let timer = 0;
    let turn = 0; // 다시 시도가 끼어들어도 고리는 하나 — 마지막에 시작한 물음만 다음 차례를 건다
    const pull = async () => {
      window.clearTimeout(timer);
      const mine = ++turn;
      if (!document.hidden) {
        try {
          const f = unpackFrame(await browserFrame(live.profile, seq.current));
          if (alive) setPullErr('');
          if (alive && f && f.seq > seq.current) {
            seq.current = f.seq;
            const next = URL.createObjectURL(new Blob([f.jpeg as BlobPart], { type: 'image/jpeg' }));
            if (url.current) URL.revokeObjectURL(url.current);
            url.current = next;
            setSrc(next);
          }
        } catch (e) { if (alive) setPullErr(e instanceof Error && e.message ? e.message : '?'); }
      }
      if (alive && mine === turn) timer = window.setTimeout(() => void pull(), every.current);
    };
    pullNow.current = () => void pull();
    void pull();
    return () => { alive = false; window.clearTimeout(timer); pullNow.current = () => {}; if (url.current) URL.revokeObjectURL(url.current); url.current = ''; };
  }, [live.profile]);

  // 붙었는데 탭 0개가 얼마나 이어졌나 — 잠깐(탭 바꾸며 닫고 열기)은 닫힘이 아니다
  const emptySince = useRef<number | null>(null);
  const empty = !!live.screen?.attached && live.screen.pages === 0;
  if (!empty) emptySince.current = null;
  else if (emptySince.current == null) emptySince.current = Date.now();
  const trouble = phoneTrouble(live.screen, pullErr, emptySince.current == null ? 0 : Date.now() - emptySince.current);
  const retry = () => {
    setPullErr('');
    void browserRetry(live.profile, live.sessionPid).then(() => pullNow.current(), (e: unknown) => setPullErr(e instanceof Error && e.message ? e.message : '?'));
  };
  const troubleLine = trouble && (
    <div className="m-br-trouble" role="status">
      <span>{trouble.text}</span>
      <button type="button" className="m-plain" onClick={retry} aria-label="다시 시도" title="다시 시도"><IconRefresh /></button>
    </div>
  );

  const fail = (e: unknown) => setErr(e instanceof Error && e.message ? e.message : '못 했어 — 브라우저가 바뀌었을 수 있어');
  const take = () => { setErr(''); void browserTakeover(live.profile, live.sessionPid, true).then(() => { setWant(true); setBig(true); }, fail); };
  const give = () => { setErr(''); void browserTakeover(live.profile, live.sessionPid, false).then(() => setWant(false), fail); };
  const send = (events: InputEv[]) => void browserInput(live.profile, live.sessionPid, events).catch(fail);

  const status = live.ask ? `세션이 불러요 — ${live.ask.reason}` : ctl === 'mine' ? takeoverLine({ ...live, takeover: live.takeover ?? { by: 'phone', at: Date.now() } }) : null;
  const action = live.ask
    ? <button type="button" className="m-btn m-br-act" onClick={give}>다 했어</button>
    : ctl === 'mine'
      ? <button type="button" className="m-btn m-br-act" onClick={give}>돌려주기</button>
      : <button type="button" className="m-btn" onClick={take}>개입</button>;

  return (
    <div className="m-br">
      <button type="button" className="m-br-shot" onClick={() => setBig(true)} aria-label="브라우저 화면 크게">
        {src ? <img src={src} alt={live.title || '세션 브라우저 화면'} className={trouble ? 'm-br-stale' : undefined} /> : !trouble && <span className="m-muted m-sm">화면 받는 중…</span>}
      </button>
      {troubleLine}
      {big && (
        <div className="m-view" role="dialog" aria-label="세션 브라우저 화면">
          <div className="m-picker-head">
            <b className="m-view-title">{live.title || host(live.url)}</b>
            {action}
            <button type="button" className="m-plain" onClick={() => setBig(false)}>닫기</button>
          </div>
          {status && <div className={`m-br-status ${live.ask ? 'm-br-ask' : ''}`} role="status">{status}</div>}
          {err && <div className="m-br-err" role="alert">{err}</div>}
          {troubleLine}
          {ctl === 'view'
            ? <div className="m-view-body">{src && <ZoomBox><img src={src} alt={live.title || '세션 브라우저 화면'} /></ZoomBox>}</div>
            : <Control src={src} alt={live.title || '세션 브라우저 화면'} send={send} />}
        </div>
      )}
      <div className="m-br-line">
        {live.busy && <span className="m-live-dots" aria-hidden><i /><i /><i /></span>}
        <span className="m-br-title">{live.title || host(live.url)}</span>
        <span className="m-br-host">{host(live.url)}</span>
      </div>
      {status ? <div className={`m-br-status m-br-inline ${live.ask ? 'm-br-ask' : ''}`}>{status}</div> : live.tool && <div className="m-muted m-sm m-br-tool">{live.tool}</div>}
      <div className="m-br-acts">{action}</div>
    </div>
  );
}

/** 개입 중 화면 — 누르면 그 자리 누르기, 밀면 스크롤. 아래 줄에서 글자 넣기·Enter·지우기(친 글은 보내자마자 비운다) */
function Control({ src, alt, send }: { src: string; alt: string; send: (ev: InputEv[]) => void }) {
  const img = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number; p: { x: number; y: number }; scale: number } | null>(null);
  const [text, setText] = useState('');
  const at = (cx: number, cy: number) => {
    const el = img.current;
    return el ? pointIn(cx, cy, el.getBoundingClientRect(), el.naturalWidth, el.naturalHeight) : null;
  };
  const submit = () => { if (text) { send([{ kind: 'text', text }]); setText(''); } };
  return (
    <>
      {/* 자리는 손가락이 닿은 그때 그림으로 잰다 — 떼는 사이 그림·윗줄이 바뀌면 엉뚱한 자리를 눌렀다(QA: 체크박스 대신 위 칸) */}
      <div className="m-br-ctl" onPointerDown={(e) => {
          const el = img.current;
          const p = at(e.clientX, e.clientY);
          start.current = p && el ? { x: e.clientX, y: e.clientY, p, scale: el.naturalWidth / Math.max(1, el.getBoundingClientRect().width) } : null;
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (s) send(phoneGesture(s.p, e.clientX - s.x, e.clientY - s.y, s.scale));
        }}>
        {src ? <img ref={img} src={src} alt={alt} draggable={false} /> : <span className="m-muted m-sm">화면 받는 중…</span>}
      </div>
      <form className="m-br-type" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="누른 칸에 넣을 글" aria-label="브라우저에 넣을 글"
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="send" />
        <button type="submit" className="m-plain" aria-label="글 넣기" title="글 넣기" disabled={!text}><IconSend /></button>
        <button type="button" className="m-plain" aria-label="Enter" title="Enter" onClick={() => send(phoneKey('Enter'))}><IconEnter /></button>
        <button type="button" className="m-plain" aria-label="지우기" title="지우기" onClick={() => send(phoneKey('Backspace'))}><IconBackspace /></button>
      </form>
    </>
  );
}

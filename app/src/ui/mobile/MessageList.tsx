// 말풍선 목록 — parseChat 결과를 그리는 얇은 목록(데스크톱 ChatView 는 tauri 의존이라 통째로 못 쓴다)
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { stripMarks, type ChatItem } from '../../domain/chat';
import { nearBottom, phoneBubble, phoneName, stickBottom, wantEarlier, type PhoneAtt } from '../../domain/mobile';
import type { OutMsg } from '../../domain/mobileOutbox';
import type { EarlierApi } from './useEarlier';
import { IconClose, IconRefresh } from '../Icons';
import { mdToHtmlNewTab } from '../md';
import { useBlobUrl } from './useBlobUrl';
import { interleave } from '../../domain/chatExtras';
import type { ChatFile } from '../../domain/chatFiles';
import { ChatFileCard } from './ChatFileCard';

// 마크다운 → HTML 은 한 번 바꾼 걸 기억한다(폴링마다 말풍선 수백 개를 다시 바꾸지 않게)
const mdCache = new Map<string, string>();
const md = (text: string) => {
  const hit = mdCache.get(text);
  if (hit !== undefined) return hit;
  const html = mdToHtmlNewTab(stripMarks(text));
  if (mdCache.size > 2000) mdCache.clear();
  mdCache.set(text, html);
  return html;
};

/** 붙인 그림 썸네일 — 누르면 크게, 한 번 더 누르면 작게(데스크톱 Thumb 와 같은 동작). 그림 아닌 파일은 이름표만 */
function Thumb({ att }: { att: PhoneAtt }) {
  const url = useBlobUrl(att.image ? att.path : null, true);
  const [big, setBig] = useState(false);
  if (!att.image) return <span className="m-pic-file">{att.label} {att.path.split('.').pop()?.toUpperCase()}</span>;
  return (
    <button type="button" className={big ? 'm-pic m-big' : 'm-pic'} onClick={() => setBig((b) => !b)} aria-label={`${att.label} ${big ? '작게' : '크게'}`}>
      {url ? <img src={url} alt="" /> : <span className="m-pic-wait" />}
      <em>{att.label}</em>
    </button>
  );
}

/** 내 말 — 폰에서 붙인 첨부 경로는 썸네일로(phoneBubble), 데스크톱에서 붙인 그림(data URL)도 같은 자리에 */
function Mine({ text, images, pending }: { text: string; images?: string[]; pending?: boolean }) {
  const { body, atts } = phoneBubble(text);
  const all: PhoneAtt[] = [...(images ?? []).map((src, i) => ({ path: src, label: `@img${i + 1}`, image: true })), ...atts];
  return (
    <div className={pending ? 'm-bubble m-me m-pending' : 'm-bubble m-me'}>
      {all.length > 0 && <div className="m-pics">{all.map((a) => <Thumb key={a.path} att={a} />)}</div>}
      {body}
    </div>
  );
}

/** 보낼 함 말풍선 — 보내는 중은 흐리게, 못 보냈으면 아래에 이유 + 다시 보내기·지우기 */
function Outgoing({ m, onRetry, onDrop }: { m: OutMsg; onRetry: (id: string) => void; onDrop: (id: string) => void }) {
  if (m.status !== 'failed') return <Mine text={m.text} pending />;
  return (
    <div className="m-out-failed">
      <Mine text={m.text} />
      <div className="m-out-row">
        <span className="m-out-why">못 보냈어요{m.error ? ` · ${m.error}` : ''}</span>
        <button type="button" className="m-icon" onClick={() => onRetry(m.id)} aria-label="다시 보내기" title="다시 보내기"><IconRefresh /></button>
        <button type="button" className="m-icon" onClick={() => onDrop(m.id)} aria-label="이 말 지우기" title="지우기"><IconClose /></button>
      </div>
    </div>
  );
}

function Bubble({ it }: { it: ChatItem }) {
  if (it.kind === 'user') return <Mine text={it.text} images={it.images} />;
  // 답은 마크다운으로 — DOMPurify 를 거친 HTML 만(ui/md.ts), 링크는 새 탭
  if (it.kind === 'assistant') return <div className="m-bubble m-ai m-md" dangerouslySetInnerHTML={{ __html: md(it.text) }} />;
  if (it.kind === 'tools') return <div className="m-tools">{it.tools.length === 1 ? `${it.tools[0]!.name} ${it.tools[0]!.target}` : `도구 ${it.tools.length}번`}</div>;
  if (it.kind === 'relay') return <div className="m-relay"><b>{phoneName(it.from, [])}</b> {it.text}</div>;
  return <div className="m-note">{it.text}</div>;
}

/** ask = 지금 참모가 사용자에게 묻고 멈춘 것 — 대화 끝에 카드로(답은 아래 입력칸에) */
/** 일하는 중 한 줄 — 데스크톱 채팅의 '작업 중 · 도구'(liveWork). 점 세 개가 차례로 깜빡인다(동작 줄이기면 멈춤) */
function LiveRow({ live }: { live: LiveState }) {
  const parts = [live.tools ? `도구 ${live.tools}번` : '', live.secs >= 3 ? (live.secs < 60 ? `${live.secs}초` : `${Math.floor(live.secs / 60)}분 ${live.secs % 60}초`) : ''].filter(Boolean);
  return (
    <div className="m-live" role="status" aria-live="polite">
      <span className="m-live-dots" aria-hidden><i /><i /><i /></span>
      <span className="m-live-line">{live.line || '생각 중…'}</span>
      {parts.length > 0 && <span className="m-live-meta">{parts.join(' · ')}</span>}
    </div>
  );
}
type LiveState = { busy: boolean; line: string; tools: number; secs: number };

/** 처음엔 끝 말 이만큼만 그리고, 위로 올리면 더(그다음엔 서버에서 앞 대화를 거슬러) */
const SHOW_STEP = 200;

export function MessageList({ items, out, onRetry, onDrop, live, ask, who, earlier, loading, stale, files, onOpenFile }: { items: ChatItem[]; out: OutMsg[]; onRetry: (id: string) => void; onDrop: (id: string) => void; live?: LiveState; ask?: { lead: string; q: string } | null; who?: ReactNode;
  /** 참모가 보여 준 파일(domain/chatFiles) — 그 시각 자리 말풍선 사이에 카드로. 그려진 첫 말보다 앞선 건 안 그린다(clip) */
  files?: ChatFile[];
  onOpenFile?: (f: ChatFile) => void;
  /** 옛 기억을 그리는 중(돌아온 뒤 첫 답 전) — 흐리게 + 도는 표시, 물음 카드는 접는다 */
  stale?: boolean;
  /** 앞 대화 거슬러 읽기(useEarlier) — 없으면 받은 것만 */
  earlier?: EarlierApi;
  /** 아직 한 번도 못 읽음 — 빈 목록 대신 '불러오는 중' */
  loading?: boolean }) {
  const [shown, setShown] = useState(SHOW_STEP);
  // 바닥 붙이기 — 바닥 근처를 보던 중이면 키보드가 올라와 목록이 줄어도(ResizeObserver)·새 말풍선이 와도 맨 아래로,
  // 내가 막 보냈으면 늘. 위로 올려 옛 글을 보는 중이면 그대로(2026-10-03 사용자 "한 번씩 가려져서 내려야 해")
  const log = useRef<HTMLDivElement>(null);
  const near = useRef(true);
  const mine = useRef(out.length);
  const toBottom = () => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const on = () => {
      near.current = nearBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
      prev.current.h = el.scrollHeight; // 그림이 늦게 그려져 높이가 바뀐 것도 따라간다(다음에 붙을 때 그만큼 더 밀지 않게)
      // 위로 무한 스크롤 — 위 끝에 닿기 전, 화면 한 장 남았을 때 미리(2026-10-03 사용자)
      if (el.scrollTop < el.clientHeight) top.current();
    };
    el.addEventListener('scroll', on, { passive: true });
    if (typeof ResizeObserver === 'undefined') return () => el.removeEventListener('scroll', on);
    const ro = new ResizeObserver(() => { if (near.current) toBottom(); });
    ro.observe(el);
    return () => { el.removeEventListener('scroll', on); ro.disconnect(); };
  }, []);
  // 위로 화면 한 장도 안 남았으면 — 안 그린 말이 남았으면 더 그리고, 다 그렸으면 서버에서 앞 대화
  const top = useRef(() => {});
  top.current = () => {
    const el = log.current;
    if (!el || !wantEarlier({ scrollTop: el.scrollTop, clientHeight: el.clientHeight, loading: !!earlier?.loading, done: false })) return;
    if (items.length > shown) { setShown((n) => n + SHOW_STEP); return; }
    if (earlier && !earlier.done) void earlier.more();
  };
  const olderN = earlier?.items.length ?? 0;
  // 앞에 붙으면 붙은 높이만큼 지금 자리에 더한다 — 불러오는 사이 더 올렸어도 보던 말이 그 자리에(시작할 때 자리로 되돌리면 홱 당겨졌다)
  const prev = useRef({ h: 0, older: olderN, shown, done: !!earlier?.done });
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const p = prev.current;
    const grew = olderN !== p.older || shown !== p.shown || !!earlier?.done !== p.done;
    if (grew && p.h) el.scrollTop += el.scrollHeight - p.h;
    prev.current = { h: el.scrollHeight, older: olderN, shown, done: !!earlier?.done };
  });
  // 한 번에 붙는 말이 적으면(도구 결과만 긴 구간) 위로 화면 한 장이 찰 때까지 연달아 — 목록이 짧아 스크롤이 안 될 때도
  useEffect(() => {
    const el = log.current;
    if (el && earlier && wantEarlier({ scrollTop: el.scrollTop, clientHeight: el.clientHeight, loading: earlier.loading, done: earlier.done })) top.current();
  }, [olderN, earlier?.loading, earlier?.done, items.length, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const sent = out.length > mine.current;
    mine.current = out.length;
    if (stickBottom({ wasNear: near.current, sentMine: sent })) { toBottom(); near.current = true; }
  }, [items.length, out.length, !!ask, !!live?.busy, live?.line, files?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={log} className={stale ? 'm-log m-stale' : 'm-log'}>
      {earlier && (items.length <= shown) && (earlier.loading
        ? <div className="m-older-spin" role="status" aria-label="앞 대화 불러오는 중"><span className="m-live-dots" aria-hidden><i /><i /><i /></span></div>
        : earlier.done && <div className="m-note m-older">대화 처음이에요</div>)}
      {interleave([...(earlier?.items ?? []).map((it, i) => ({ it, ts: it.ts, k: `o-${it.id}-${i}` })), ...items.slice(-shown).map((it, i) => ({ it, ts: it.ts, k: `${it.id}-${i}` }))],
        (files ?? []).map((f) => ({ ...f, clip: true }))).map((x) => ('item' in x
        ? <Bubble key={x.item.k} it={x.item.it} />
        : <ChatFileCard key={x.extra.key} f={x.extra} onOpen={(f) => onOpenFile?.(f)} />))}
      {loading && !items.length && <div className="m-note m-older">대화 불러오는 중…</div>}
      {out.map((m) => <Outgoing key={m.id} m={m} onRetry={onRetry} onDrop={onDrop} />)}
      {live?.busy && <LiveRow live={live} />}
      {stale && <div className="m-resync" role="status" aria-label="최신 대화 받는 중"><span className="m-spin" aria-hidden /></div>}
      {ask && out.length === 0 && !live?.busy && !stale && (
        <div className="m-ask">
          <div className="m-ask-label">{who}답을 기다려요</div>
          {ask.lead && <div className="m-muted m-sm">{ask.lead}</div>}
          <div className="m-ask-q">{ask.q}</div>
        </div>
      )}
    </div>
  );
}

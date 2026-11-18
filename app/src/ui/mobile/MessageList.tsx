// 말풍선 목록 — parseChat 결과를 그리는 얇은 목록(데스크톱 ChatView 는 tauri 의존이라 통째로 못 쓴다)
// 내 말·참모 말풍선을 길게 누르면 '참조'(입력칸에 #chat1, 데스크톱과 같은 인용 블록)·'복사'(2026-10-23 사용자 — 글을 복사해 붙이고 있었다)
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { tr } from '../../i18n';
import { chatNorm, dropRescued, errorTurns, splitRefs, stripMarks, type ChatItem } from '../../domain/chat';
import { bubbleWho } from '../../domain/refChips';
import { BottomSheet } from './kit';
import { usePress } from './PhoneLockerParts';
import { farFromBottom, jumpDot, liveMeta, nearAfterScroll, nearBottom, phoneBubble, phoneName, stickBottom, wantEarlier, type PhoneAtt } from '../../domain/mobile';
import type { OutMsg } from '../../domain/mobileOutbox';
import { sentMentionLabel, splitTokens } from '../../domain/chatTokens';
import type { EarlierApi } from './useEarlier';
import { IconChevronDown, IconRefresh } from '../Icons';
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
    <button type="button" className={big ? 'm-pic m-big' : 'm-pic'} onClick={() => setBig((b) => !b)} aria-label={`${att.label} ${big ? tr('작게', 'Shrink') : tr('크게', 'Enlarge')}`}>
      {url ? <img src={url} alt="" /> : <span className="m-pic-wait" />}
      <em>{att.label}</em>
    </button>
  );
}

type Press = ReturnType<typeof usePress>;
type Hold = (who: string, text: string) => void;
const noop = () => {};

/** 내 말 — 폰에서 붙인 첨부 경로는 썸네일로(phoneBubble), 데스크톱에서 붙인 그림(data URL)도 같은 자리에. 말풍선 참조는 아래 인용으로(데스크톱과 같은 모양) */
function Mine({ text, images, press, dim }: { text: string; images?: string[]; press?: Press; /** 끝내 안 감·답을 못 받음 — 살짝 흐리게 */ dim?: boolean }) {
  const { body: said, refs } = splitRefs(text);
  const { body, atts } = phoneBubble(said);
  const all: PhoneAtt[] = [...(images ?? []).map((src, i) => ({ path: src, label: `#img${i + 1}`, image: true })), ...atts];
  return (
    <div className={dim ? 'm-bubble m-me m-dim' : 'm-bubble m-me'} {...press}>
      {all.length > 0 && <div className="m-pics">{all.map((a) => <Thumb key={a.path} att={a} />)}</div>}
      {mentionText(body)}
      {refs.map((r) => <div key={r.label} className="m-quote"><b>{r.label}</b> {r.who}<div className="m-quote-q">{r.text}</div></div>)}
    </div>
  );
}

/** 복사 — 홈 화면 앱이 http 로 열리면 navigator.clipboard 가 없다(보안 출처 아님) → 숨은 글 칸으로 */
function copyText(text: string) {
  if (navigator.clipboard?.writeText) { void navigator.clipboard.writeText(text).catch(() => copyOld(text)); return; }
  copyOld(text);
}
function copyOld(text: string) {
  const t = document.createElement('textarea');
  t.value = text;
  t.setAttribute('readonly', '');
  t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(t);
  t.select();
  t.setSelectionRange(0, text.length);
  try { document.execCommand('copy'); } catch { /* 못 하면 조용히 */ }
  t.remove();
}

/** 데스크톱에서 보낸 멘션 @[참모-3 · 가나 담당] 은 화면 이름 @가나 담당 으로 */
const mentionText = (body: string) => splitTokens(body).map((t) => (typeof t === 'string' ? t : 'mention' in t ? `@${sentMentionLabel(t.mention)}` : 'ref' in t ? t.ref : t.live)).join('');

/** 다시 보내기 아이콘 — 점 자리(말풍선 바깥 왼쪽, 아이폰 메시지의 빨간 ! 자리). 글자 안내 없이 이름만(2026-11-17 사용자) */
function Again({ title, onClick }: { title: string; onClick: () => void }) {
  return <button type="button" className="m-icon m-again" onClick={onClick} aria-label={tr('다시 보내기', 'Resend')} title={title}><IconRefresh /></button>;
}

/** 보낼 함 말풍선 — 보내자마자 보통 내 말풍선, 아직 안 읽혔으면 옆에 작은 점 하나(데스크톱 채팅과 같이, 2026-11-17 사용자 — 흐리면 안 간 것처럼 보였다).
 *  못 보냈으면 그 점 자리에 다시 보내기 아이콘 + 말풍선 살짝 흐리게. 빼기는 길게 누르기 메뉴로만(화면 단추 없음) */
function Outgoing({ m, onRetry, onDrop }: { m: OutMsg; onRetry: (id: string) => void; onDrop: (id: string) => void }) {
  const failed = m.status === 'failed';
  const [menu, setMenu] = useState(false);
  const press = usePress(noop, () => { if (failed) setMenu(true); });
  if (!failed) return <div className="m-out-wait"><span className="m-unread" role="img" aria-label={tr('아직 안 읽음', 'Not read yet')} /><Mine text={m.text} /></div>;
  const why = m.error || tr('전해지지 않았어요', 'Not delivered');
  return (
    <div className="m-out-wait">
      <Again title={`${why} — ${tr('다시 보내기', 'Resend')}`} onClick={() => onRetry(m.id)} />
      <Mine text={m.text} press={press} dim />
      {menu && (
        <BottomSheet label={tr('보내지 못한 말', 'Unsent message')} kind="card" armMs={450} onClose={() => setMenu(false)}>
          {({ close, armed }) => (
            <>
              <button type="button" className="m-menu-item" onClick={() => { if (armed) { close(); onRetry(m.id); } }}>{tr('다시 보내기', 'Resend')}</button>
              <button type="button" className="m-menu-item m-danger-ink" onClick={() => { if (armed) { close(); onDrop(m.id); } }}>{tr('빼기', 'Remove')}</button>
            </>
          )}
        </BottomSheet>
      )}
    </div>
  );
}

function Bubble({ it, onHold, again }: { it: ChatItem; onHold?: Hold; /** Claude 오류로 답을 못 받은 내 말 — 바깥에 다시 보내기(domain/chat errorTurns) */ again?: () => void }) {
  const mine = it.kind === 'user';
  const press = usePress(noop, () => (it.kind === 'user' || it.kind === 'assistant') && onHold?.(bubbleWho(mine, it.ts), mine ? splitRefs(it.text).body : it.text));
  const held = onHold ? press : undefined;
  if (it.kind === 'user' && again) return <div className="m-out-wait"><Again title={tr('답을 못 받음 — 다시 보내기', 'No reply — resend')} onClick={again} /><Mine text={it.text} images={it.images} press={held} dim /></div>;
  if (it.kind === 'user') return <Mine text={it.text} images={it.images} press={held} />;
  // 답은 마크다운으로 — DOMPurify 를 거친 HTML 만(ui/md.ts), 링크는 새 탭
  if (it.kind === 'assistant') return <div className="m-bubble m-ai m-md" dangerouslySetInnerHTML={{ __html: md(it.text) }} {...held} />;
  if (it.kind === 'tools') return <div className="m-tools">{it.tools.length === 1 ? `${it.tools[0]!.name} ${it.tools[0]!.target}` : tr(`도구 ${it.tools.length}번`, `${it.tools.length} tool calls`)}</div>;
  if (it.kind === 'relay') return <div className="m-relay"><b>{it.session ? phoneName(it.from, []) : it.from}</b> {it.text}</div>;
  return <div className="m-note">{it.text}</div>;
}

/** ask = 지금 참모가 사용자에게 묻고 멈춘 것 — 대화 끝에 카드로(답은 아래 입력칸에) */
/** 일하는 중 한 줄 — 데스크톱 채팅의 '작업 중 · 도구'(liveWork). 점 세 개가 차례로 깜빡인다(동작 줄이기면 멈춤) */
function LiveRow({ live }: { live: LiveState }) {
  const meta = liveMeta(live);
  return (
    <div className="m-live" role="status" aria-live="polite">
      <span className="m-live-dots" aria-hidden><i /><i /><i /></span>
      <span className="m-live-line">{live.line || tr('생각 중…', 'Thinking…')}</span>
      {meta && <span className="m-live-meta">{meta}</span>}
    </div>
  );
}
type LiveState = { busy: boolean; line: string; tools: number; secs: number };

/** 처음엔 끝 말 이만큼만 그리고, 위로 올리면 더(그다음엔 서버에서 앞 대화를 거슬러) */
const SHOW_STEP = 200;

export function MessageList({ items, out, onRetry, onDrop, onResend, live, ask, who, earlier, loading, stale, files, onOpenFile, onRef, kids }: { items: ChatItem[]; out: OutMsg[]; onRetry: (id: string) => void; onDrop: (id: string) => void; live?: LiveState; ask?: { lead: string; q: string } | null; who?: ReactNode;
  /** 키즈 참모 — 아이 화면 대화를 그 시각 자리에(두 세션 한 줄기, usePhoneKids) */
  kids?: { ts: string; key: string; clip?: boolean; node: ReactNode }[];
  /** Claude 오류로 답을 못 받은 내 말을 같은 글로 다시 보내기 — 없으면(읽기만 하는 엿보기) 아이콘도 없다 */
  onResend?: (text: string) => void;
  /** 길게 누른 말풍선을 입력칸에 #chat 참조로 — 없으면 길게 누르기 메뉴도 없다 */
  onRef?: Hold;
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
  const [held, setHeld] = useState<{ who: string; text: string } | null>(null);
  // 바닥 붙이기 — 바닥 근처를 보던 중이면 키보드가 올라와 목록이 줄어도(ResizeObserver)·새 말풍선이 와도 맨 아래로,
  // 내가 막 보냈으면 늘. 위로 올려 옛 글을 보는 중이면 그대로(2026-10-03 사용자 "한 번씩 가려져서 내려야 해")
  const log = useRef<HTMLDivElement>(null);
  const near = useRef(true);
  const mine = useRef(out.length);
  const toBottom = () => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; };
  // 맨 아래로 버튼 — 데스크톱 채팅과 같이 400px 넘게 올려 읽을 때만, 그사이 새 답이 오면 점(2026-10-17 사용자 폰)
  const [away, setAway] = useState(false);
  const [dot, setDot] = useState(false);
  // 이어진 답은 말풍선 하나로 합쳐지니 개수가 아니라 답 글 양으로 잰다
  const replies = items.reduce((n, it) => n + (it.kind === 'assistant' ? it.text.length : 0), 0);
  const seen = useRef(replies);
  useEffect(() => {
    setDot((d) => jumpDot({ dot: d, away, before: seen.current, after: replies }));
    seen.current = replies;
  }, [replies, away]);
  const jump = () => { const el = log.current; if (!el) return; near.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); setAway(false); };
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    // 사람 손 — 손가락·휠·키. 이 1초 안의 스크롤만 '위로 읽는 중'으로 친다(nearAfterScroll)
    let handAt = 0;
    const hand = () => { handAt = Date.now(); };
    const on = () => {
      near.current = nearAfterScroll({ was: near.current, nearNow: nearBottom(el.scrollHeight, el.scrollTop, el.clientHeight), handMs: Date.now() - handAt });
      setAway(farFromBottom(el.scrollHeight, el.scrollTop, el.clientHeight));
      prev.current.h = el.scrollHeight; // 그림이 늦게 그려져 높이가 바뀐 것도 따라간다(다음에 붙을 때 그만큼 더 밀지 않게)
      // 위로 무한 스크롤 — 위 끝에 닿기 전, 화면 한 장 남았을 때 미리(2026-10-03 사용자)
      if (el.scrollTop < el.clientHeight) top.current();
    };
    const hands = ['touchstart', 'touchmove', 'wheel', 'pointerdown', 'keydown'] as const;
    hands.forEach((t) => el.addEventListener(t, hand, { passive: true }));
    el.addEventListener('scroll', on, { passive: true });
    const off = () => { el.removeEventListener('scroll', on); hands.forEach((t) => el.removeEventListener(t, hand)); };
    if (typeof ResizeObserver === 'undefined') return off;
    const ro = new ResizeObserver(() => { if (near.current) toBottom(); });
    ro.observe(el);
    return () => { off(); ro.disconnect(); };
  }, []);
  // 위로 화면 한 장도 안 남았으면 — 안 그린 말이 남았으면 더 그리고, 다 그렸으면 서버에서 앞 대화
  const top = useRef(() => {});
  top.current = () => {
    const el = log.current;
    if (!el || !wantEarlier({ scrollTop: el.scrollTop, clientHeight: el.clientHeight, loading: !!earlier?.loading, done: false })) return;
    if (items.length > shown) { setShown((n) => n + SHOW_STEP); return; }
    if (earlier && !earlier.done) void earlier.more();
  };
  // 끊고 보내기가 다시 넣은 말은 한 번만(domain/chat dropRescued — 데스크톱 채팅과 같이)
  const said = useMemo(() => dropRescued(items), [items]);
  // 갔지만 Claude 오류로 답을 못 받은 내 말(데스크톱 ChatView 와 같은 기준) — 그림 붙인 말·이미 다시 보낸 말(보낼 함)은 빼고, 로그인 풀림은 로그인 카드가 맡는다
  const unanswered = useMemo(() => {
    const ids = new Set<string>();
    if (!onResend) return ids;
    for (const [id, k] of errorTurns(said)) {
      const it = said.find((i) => i.id === id);
      if (k === 'retry' && it?.kind === 'user' && !it.images?.length && !out.some((o) => chatNorm(o.text) === chatNorm(it.text))) ids.add(id);
    }
    return ids;
  }, [said, out, onResend]);
  const againOf = (text: string) => () => onResend?.(text);
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
        ? <div className="m-older-spin" role="status" aria-label={tr('앞 대화 불러오는 중', 'Loading earlier messages')}><span className="m-live-dots" aria-hidden><i /><i /><i /></span></div>
        : earlier.done && <div className="m-note m-older">{tr('대화 처음이에요', 'Start of the conversation')}</div>)}
      {interleave([...(earlier?.items ?? []).map((it, i) => ({ it, ts: it.ts, k: `o-${it.id}-${i}` })), ...said.slice(-shown).map((it, i) => ({ it, ts: it.ts, k: `${it.id}-${i}` }))],
        [...(files ?? []).map((f) => ({ ...f, clip: true })), ...(kids ?? []).map((k) => ({ ...k, kid: true as const }))]).map((x) => ('item' in x
        ? <Bubble key={x.item.k} it={x.item.it} onHold={onRef ? (w, t) => setHeld({ who: w, text: t }) : undefined} again={onResend && unanswered.has(x.item.it.id) && 'text' in x.item.it ? againOf(x.item.it.text) : undefined} />
        : 'kid' in x.extra ? <div key={x.extra.key} className="m-kid-row">{x.extra.node}</div>
        : <ChatFileCard key={x.extra.key} f={x.extra} onOpen={(f) => onOpenFile?.(f)} />))}
      {loading && !items.length && <div className="m-note m-older">{tr('대화 불러오는 중…', 'Loading the conversation…')}</div>}
      {out.map((m) => <Outgoing key={m.id} m={m} onRetry={onRetry} onDrop={onDrop} />)}
      {live?.busy && <LiveRow live={live} />}
      {stale && <div className="m-resync" role="status" aria-label={tr('최신 대화 받는 중', 'Getting the latest messages')}><span className="m-spin" aria-hidden /></div>}
      {ask && out.length === 0 && !live?.busy && !stale && (
        <div className="m-ask">
          <div className="m-ask-label">{who}{tr('답을 기다려요', 'Waiting for your reply')}</div>
          {ask.lead && <div className="m-muted m-sm">{ask.lead}</div>}
          <div className="m-ask-q">{ask.q}</div>
        </div>
      )}
      {held && onRef && (
        <BottomSheet label={held.who} kind="card" title={held.who} armMs={450} onClose={() => setHeld(null)}>
          {({ close, armed }) => (
            <>
              <button type="button" className="m-menu-item" onClick={() => { if (armed) { close(); onRef(held.who, held.text); } }}>{tr('참조', 'Reference')}</button>
              <button type="button" className="m-menu-item" onClick={() => { if (armed) { close(); copyText(held.text); } }}>{tr('복사', 'Copy')}</button>
            </>
          )}
        </BottomSheet>
      )}
      {away && (
        <div className="m-jump-at">
          <button type="button" className="m-jump" onClick={jump} aria-label={dot ? tr('맨 아래로 · 새 답', 'Jump to bottom · new reply') : tr('맨 아래로', 'Jump to bottom')} title={tr('맨 아래로', 'Jump to bottom')}>
            <IconChevronDown />
            {dot && <span className="m-jump-dot" aria-hidden />}
          </button>
        </div>
      )}
    </div>
  );
}

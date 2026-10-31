// 폰 홈 모드 카드(폰 홈·보관함 v1 1 — 세션 줄 아래 카드 한 칸, 여럿이면 칸 안 알약, 오른쪽 위 = 꽉 채워 보기).
// 데스크톱 홈과 같은 모드(이 참모 대시보드 칸 자리 dash)를 같은 트리 그리기(ui/mode/ModeTree)로. 데스크톱 앱이 밀어 줄 길이 없어 보는 동안 10초마다 다시 받는다.
// 하나도 없으면 빈 칸에 고르기 목록(내가 만든 것·참모 모드, 골라 켜기)·말로 만들기(참모에게). 머리 = 꽉 채워 보기 · ⋯(모드 고르기·이 홈에서 끄기 — X 를 머리에 두지 않는다, 10/15 사용자 B)
// 모드 안 뒤로는 모드가 그린 키트 BackBar, 칸 왼쪽 끝에서 오른쪽으로 밀어도 그 단추를 누른다(domain/modeNav)
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { modeAct, modeCard, modeClose, modeOpen, modeRemove, modeRestore, readModeView, readModes, type PhoneModeRow } from '../../data/web';
import { phoneRemove } from '../../domain/modeManage';
import { ModeCardArt, useModeCard } from '../mode/ModeCardArt';
import { openInTurn, pickDiff, pickGroups, type PickItem } from '../../domain/homeModes';
import { dashModes, phoneCells, hrefOk, normalize, type Act, type TNode } from '../../domain/modeTree';
import { ModeEnvCtx, Node, type Drafts, type ModeEnv } from '../mode/ModeTree';
import { useScheme } from '../scheme';
import '../mode/mode.css';
import { IconCheck, IconHide, IconMaximize, IconMore, IconSend, IconTrash } from '../Icons';
import { edgeSwipe } from '../../domain/modeNav';
import { closeOnOutside } from '../outsideClose';
import { BottomSheet, IconBtn } from './kit';
import { useMemoPoll } from './usePoll';
import { machine, tr } from '../../i18n';
import { seenName } from '../../domain/session';

const EVERY = 10_000;
// 폰에선 웹 주소만 새 탭으로 — 컴퓨터 파일(file:)은 폰이 못 연다. Client 칸(모드 화면 모듈)은 컴퓨터 앱에서만
const ENV: ModeEnv = { open: (href) => { if (hrefOk(href) && /^https?:/i.test(href)) window.open(href, '_blank', 'noopener'); }, client: null };
const TRY: Record<string, () => string> = { 'home-calendar': () => tr('달력', 'Calendar'), 'home-board': () => tr('현황판', 'Board'), 'home-todo': () => tr('할 일', 'To-do'), 'team-status': () => tr('참모 상태', 'Team') };
const exampleTitle = (n: string) => TRY[n]?.() ?? n;

type View = { note: string | null; tree: TNode | null };

/** 칸 안쪽 크기(padding 뺀 것 — 데스크톱 ModeView 의 contentRect 와 같다). clientWidth 그대로면 모드가 3칸 넓게 그려 그림이 줄었다 */
const innerOf = (el: HTMLElement) => {
  const s = getComputedStyle(el);
  const n = (v: string) => parseFloat(v) || 0;
  return { w: el.clientWidth - n(s.paddingLeft) - n(s.paddingRight), h: el.clientHeight - n(s.paddingTop) - n(s.paddingBottom) };
};

/** 모드 한 칸 — 상자 크기를 글자 칸으로 재 맥에 그리게 하고, 보이는 동안만 다시 받는다.
 *  홈 카드(full 아님)는 내용만큼 늘어나고 홈이 스크롤한다 — 높이는 재지 않고 늘 같은 줄 수(phoneCells). 꽉 채워 보기는 잰 높이, 넘치면 그 안에서 민다 */
function ModeBody({ name, full = false }: { name: string; full?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const drafts = useRef<Drafts>(new Map()).current;
  const [v, setV] = useState<View>({ note: tr('불러오는 중', 'Loading'), tree: null });
  const kick = useRef<() => void>(() => {});
  // 폰 화면 테마를 모드에 넘긴다 — 바뀌면 다시 받는다(#4)
  const scheme = useScheme();
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let ctl: AbortController | null = null;
    const load = () => {
      window.clearTimeout(timer);
      ctl?.abort();
      const el = box.current;
      if (!el || document.visibilityState !== 'visible') { timer = window.setTimeout(load, EVERY); return; }
      const inner = innerOf(el);
      const c = phoneCells(inner.w, full ? inner.h : null);
      ctl = new AbortController();
      readModeView(name, c.columns, c.rows, scheme, ctl.signal).then((r) => {
        if (!alive) return;
        const st = r.state;
        const note = st.unsupported ? tr('이 Claude Code 판에선 모드를 못 그려요', "This Claude Code version can't draw modes") : st.error ? tr(`모드가 멈췄어 — ${machine()}에서 다시 켜 줘`, `The mode stopped — turn it back on from the ${machine()}`) : !st.ready ? tr('모드 켜는 중', 'Starting the mode') : null;
        setV({ note, tree: r.tree ? normalize(r.tree) : null });
      }, () => { if (alive) setV((x) => (x.tree ? x : { note: tr(`${machine()}에 못 닿았어요`, `Can't reach the ${machine()}`), tree: null })); })
        .finally(() => { if (alive) timer = window.setTimeout(load, EVERY); });
    };
    kick.current = load;
    load();
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; window.clearTimeout(timer); ctl?.abort(); document.removeEventListener('visibilitychange', vis); };
  }, [name, full, scheme]);
  // 누름 — 모드가 다시 그리라고 하면 바로 다시 받는다(데스크톱 밀림이 폰엔 안 오니 늘)
  const act = (a: Act) => void modeAct(name, a).finally(() => kick.current());
  // 칸 왼쪽 끝에서 오른쪽으로 밀기 = 모드가 그린 뒤로 단추 누르기(없으면 아무것도 안 함)
  const from = useRef<{ x: number; y: number } | null>(null);
  const swipeStart = (e: TouchEvent) => { const t = e.touches[0]; from.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null; };
  const swipeEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0], f = from.current, el = box.current;
    from.current = null;
    if (!t || !f || !el) return;
    const r = el.getBoundingClientRect();
    if (edgeSwipe({ left: r.left, width: r.width }, f, { x: t.clientX, y: t.clientY })) el.querySelector<HTMLButtonElement>('[data-mode-back]:not(:disabled)')?.click();
  };
  return (
    <div className="mdv compact m-mode-body" ref={box} onTouchStart={swipeStart} onTouchEnd={swipeEnd} onTouchCancel={() => { from.current = null; }}>
      {v.note && <div className="mdv-note quiet">{v.note}</div>}
      {v.tree && <ModeEnvCtx.Provider value={ENV}><Node n={v.tree} onAct={act} drafts={drafts} /></ModeEnvCtx.Provider>}
    </div>
  );
}

/** 칸 머리 ⋯ — 늘 머리 맨 오른쪽, 드문 일(고르기·끄기)은 이 안 44px 글 줄로 */
function PhoneMore({ items }: { items: { label: string; run: () => void; warn?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => (open ? closeOnOutside(window, (t) => !!box.current && t instanceof window.Node && box.current.contains(t), () => setOpen(false)) : undefined), [open]);
  return (
    <span className="m-mode-more" ref={box}>
      <IconBtn label={tr('더보기', 'More')} onClick={() => setOpen((o) => !o)}><IconMore /></IconBtn>
      {open && (
        <div className="m-mode-menu" role="menu">
          {items.map((it) => <button key={it.label} type="button" role="menuitem" className={it.warn ? 'warn' : undefined} onClick={() => { setOpen(false); it.run(); }}>{it.label}</button>)}
        </div>
      )}
    </span>
  );
}

/** 줄 앞 작은 그림 — 모드가 정한 카드 그림·마지막 화면(데스크톱과 같은 것), 없으면 자리표시 */
function RowArt({ name }: { name: string }) {
  const art = useModeCard(name, modeCard);
  return <span className={`pv${art ? ' has-art' : ''}`} aria-hidden="true"><ModeCardArt art={art} fallback={null} /></span>;
}

const elsewhereText = (e: NonNullable<PickItem['elsewhere']>) =>
  e.where === 'dash' && e.dash ? tr(`${seenName(e.dash)} 홈에 켜짐`, `On ${seenName(e.dash)}'s home`) : e.where === 'panel' ? tr('패널에 켜짐', 'On in the panel') : e.where === 'window' ? tr('따로 창에 켜짐', 'On in a window') : tr('다른 자리에 켜짐', 'On elsewhere');

/** 고르기 목록(데스크톱 ModePick 과 같은 것) — 줄을 눌러 체크 → 켜기(차례로) · 체크 빼면 이 홈에서 끄기. 데스크톱 앱이 켜고 끈다.
 *  줄 끝 단추 = 지우기(기본 모드는 숨기기, 내가 등록한 것은 제거 — 원본 폴더 휴지통·데이터 폴더 모드는 데스크톱 관리에서) + 되돌리기 토스트 */
function PhonePick({ rows, keys, dash, onDone, onAsk, onChange }: { rows: PhoneModeRow[]; keys: string[]; dash: string; onDone: () => void; onAsk: (text: string) => void; onChange: () => void }) {
  const g = pickGroups(rows, keys, exampleTitle);
  const all = [...g.own, ...g.examples];
  const here = all.filter((x) => x.here).map((x) => x.name);
  const [chosen, setChosen] = useState<string[]>(here);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const toastT = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(toastT.current), []);
  const live = new Set(all.map((x) => x.name));
  const diff = pickDiff(here, chosen.filter((n) => live.has(n))); // 지운 것은 고른 것에서 빠진다
  const toggle = (n: string) => setChosen((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]));
  const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const undo = (name: string) => { setToast(null); void modeRestore(name).then(onChange, (e) => setFail(errOf(e))); };
  const remove = (it: PickItem) => {
    setFail(null);
    setBusy(true);
    void modeRemove(it.name).then((r) => {
      window.clearTimeout(toastT.current);
      setToast({ text: r.kind === 'hidden' ? tr(`${it.title} 숨겼어`, `${it.title} hidden`) : tr(`${it.title} 제거했어`, `${it.title} removed`), undo: r.undo ? () => undo(it.name) : undefined });
      toastT.current = window.setTimeout(() => setToast(null), 5000);
      onChange();
    }, (e) => setFail(errOf(e))).finally(() => setBusy(false));
  };
  // 켤 것 먼저 하나씩, 그다음 끌 것(데스크톱과 같다) — 못 바꾼 건 이 칸에 남긴다
  const apply = () => {
    setBusy(true);
    setFail(null);
    void (async () => {
      const dashOf = (n: string) => rows.find((r) => r.name === n)?.dash ?? dash;
      const failed = [...await openInTurn(diff.open, (n) => modeOpen(n, dash)), ...await openInTurn(diff.close, (n) => modeClose(n, dashOf(n)))];
      setBusy(false);
      if (failed.length) { setFail(failed.map((f) => `${all.find((x) => x.name === f.name)?.title ?? f.name}: ${f.error}`).join(' · ')); return; }
      onDone();
    })();
  };
  const ask = () => { const t = text.trim(); if (!t) return; onAsk(t); setText(''); onDone(); };
  const n = diff.open.length + diff.close.length;
  const list = (items: PickItem[]) => items.map((it) => {
    const on = chosen.includes(it.name);
    const way = phoneRemove(rows.find((r) => r.name === it.name)?.source ?? (it.example ? 'example' : 'folder'));
    return (
      <div key={it.name} className="m-mode-line">
        <button type="button" role="checkbox" aria-checked={on} className={`m-mode-row t-${it.example ? it.name : 'own'}${on ? ' m-on' : ''}`} disabled={busy} onClick={() => toggle(it.name)}>
          <RowArt name={it.name} />
          <span className="m-mode-rowtext"><b>{it.title}</b>{it.elsewhere && <small>{elsewhereText(it.elsewhere)}</small>}</span>
          <span className="m-mode-check" aria-hidden="true">{on && <IconCheck />}</span>
        </button>
        {way ? <IconBtn label={way === 'hide' ? tr(`${it.title} 숨기기`, `Hide ${it.title}`) : tr(`${it.title} 제거`, `Remove ${it.title}`)} disabled={busy} onClick={() => remove(it)}>{way === 'hide' ? <IconHide /> : <IconTrash />}</IconBtn> : <span className="m-mode-gap" aria-hidden="true" />}
      </div>
    );
  });
  return (
    <div className="m-mode-pick">
      {g.own.length > 0 && <><h4>{tr('내가 만든 것', 'Made by me')}</h4>{list(g.own)}<h4>{tr('참모 모드', 'Chammo modes')}</h4></>}
      {list(g.examples)}
      <div className="m-mode-say">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('어떤 화면이 필요한지 말해 보세요', 'Say what kind of screen you need')} aria-label={tr('만들 모드 말하기', 'Describe a mode to build')}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) ask(); }} />
        <IconBtn label={tr('참모에게 보내기', 'Send to your assistant')} onClick={ask} disabled={!text.trim()}><IconSend /></IconBtn>
      </div>
      <button type="button" className="m-btn m-mode-go" disabled={busy || !n} onClick={apply}>
        {diff.open.length && diff.close.length ? tr('적용', 'Apply') : diff.close.length ? tr('끄기', 'Turn off') : tr('켜기', 'Turn on')}{n > 1 ? ` ${n}` : ''}
      </button>
      {fail && <p className="m-mode-err" role="alert">{tr('못 바꿨어 — ', "Couldn't change — ")}{fail}</p>}
      {toast && <div className="m-mode-toast" role="status"><span>{toast.text}</span>{toast.undo && <button type="button" onClick={toast.undo}>{tr('되돌리기', 'Undo')}</button>}</div>}
    </div>
  );
}

/** keys = 이 참모를 가리키는 말(이름·id·sessionId — 데스크톱 ModeHome 과 같다), dash = 맛보기를 켤 자리(참모 이름) */
export function PhoneModes({ keys, dash, onAsk }: { keys: string[]; dash: string; onAsk: (text: string) => void }) {
  const [rows, , reload] = useMemoPoll<PhoneModeRow[]>('modes', () => readModes().catch(() => []), 30_000, []);
  const shown = dashModes(rows, keys);
  const [pick, setPick] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [offErr, setOffErr] = useState<string | null>(null);
  const cur = shown.find((m) => m.name === pick) ?? shown[0];
  if (!cur) {
    return (
      <section className="m-mode-try" aria-label={tr('모드 고르기', 'Pick modes')}>
        <b>{tr('내 화면 자리', 'My screen')}</b>
        <PhonePick rows={rows} keys={keys} dash={dash} onDone={reload} onAsk={onAsk} onChange={reload} />
      </section>
    );
  }
  // 이 홈에서 끄기 — 그 모드가 켜진 홈 이름(목록의 dash)을 같이 보내 맥이 그 홈에 켜진 것만 끈다
  const off = () => { setOffErr(null); void modeClose(cur.name, cur.dash ?? dash).then(reload, (e) => setOffErr(e instanceof Error ? e.message : String(e))); };
  return (
    <section className="m-mode" aria-label={tr('모드', 'Mode')}>
      <div className="m-mode-head">
        <div className="m-mode-pills" role="tablist">
          {shown.length > 1 ? shown.map((m) => (
            <button key={m.name} type="button" role="tab" aria-selected={m.name === cur.name} className={m.name === cur.name ? 'm-on' : ''} onClick={() => setPick(m.name)}>{m.title}</button>
          )) : <b>{cur.title}</b>}
        </div>
        <IconBtn label={tr('꽉 채워 보기', 'Full screen')} onClick={() => setFull(true)}><IconMaximize /></IconBtn>
        <PhoneMore items={[{ label: tr('모드 고르기', 'Pick modes'), run: () => setSheet(true) }, { label: tr('이 홈에서 끄기', 'Turn off on this home'), run: off, warn: true }]} />
      </div>
      {offErr && <p className="m-mode-err" role="alert">{tr('못 껐어 — ', "Couldn't turn off — ")}{offErr}</p>}
      <ModeBody key={cur.name} name={cur.name} />
      {full && (
        <BottomSheet label={cur.title} kind="full" title={cur.title} onClose={() => setFull(false)}>
          <div className="m-mode-full"><ModeBody name={cur.name} full /></div>
        </BottomSheet>
      )}
      {sheet && (
        <BottomSheet label={tr('모드 고르기', 'Pick modes')} title={tr('모드', 'Modes')} onClose={() => setSheet(false)}>
          <PhonePick rows={rows} keys={keys} dash={dash} onDone={() => { setSheet(false); reload(); }} onAsk={onAsk} onChange={reload} />
        </BottomSheet>
      )}
    </section>
  );
}

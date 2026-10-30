// 팀 홈 판 틀(ADR 0018, 시안 team-home v1 B) — 머리띠(팀 색·커버·팀 표·한 줄 소개) + 2열 타일 + 꾸미기 모드(손잡이 끌기·폭·빼기·서랍·되돌리기·완료).
// 꾸미기는 팀장만, 완료 때 판 한 장으로 팀에 보인다(그 전엔 이 기기 메모리). 폰은 한 줄 쌓기, 폰 꾸미기는 이름 줄로 순서·더하기·빼기만
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  addBlock, blankHome, BLOCKS, BLURB_MAX, canAdd, changedLine, COVER, coverCrop, dropAt, fromTemplate, homeSame, moveBlock, removeBlock, setMode, setWidth, specOf, TEAM_COLORS, teamColor, TEMPLATES,
  type BlockKind, type Home, type HomeApi, type HomeBlock, type HomeBoard as Board, type TemplateKey,
} from '../../domain/teamHome';
import { tr } from '../../i18n';
import { IconCamera, IconClose, IconDashboard, IconGrip, IconPencil, IconPlus, IconTrash, IconUndo, IconWidthNarrow, IconWidthWide } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { Confirm } from '../OrchDialogs';
import { usePick } from './MyProfile';
import { TeamMarkIcon } from './TeamFaces';
import type { HomeDialog } from './TeamHome';
import './teamHome.css';

export type ModeChoice = { name: string; title: string };
type Drag = { id: string; sx: number; sy: number; dx: number; dy: number; to: number; rects: { x: number; y: number; w: number; h: number }[] };

/** 그림 → 가운데 3:1 1200×400 webp data URL */
const toCover = (src: string) => new Promise<string>((ok, no) => {
  const i = new Image();
  i.onload = () => {
    const r = coverCrop(i.naturalWidth, i.naturalHeight);
    const c = document.createElement('canvas');
    c.width = COVER.w;
    c.height = COVER.h;
    const g = c.getContext('2d');
    if (!g) return no(new Error('canvas'));
    g.imageSmoothingQuality = 'high';
    g.drawImage(i, r.sx, r.sy, r.sw, r.sh, 0, 0, COVER.w, COVER.h);
    const webp = c.toDataURL('image/webp', 0.82);
    ok(webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.85));
  };
  i.onerror = () => no(new Error(tr('열 수 없는 그림이에요. png, jpeg, webp만 돼요', "Can't open this image. Use png, jpeg or webp")));
  i.src = src;
});

function Start({ onBegin }: { onBegin: (h: Home) => void }) {
  const [pick, setPick] = useState<TemplateKey>('basic');
  const mini = (k: BlockKind) => (k === 'pin' ? 'f y' : k === 'mode' ? 'f t' : specOf(k).w === 'full' ? 'f' : '');
  return (
    <section className="hb-start" aria-label={tr('팀 홈 시작', 'Start the team home')}>
      <h3>{tr('팀 홈을 어떻게 시작할까요', 'How should the team home start?')}</h3>
      <p>{tr('고른 뒤에도 블록을 더하고 빼고 옮길 수 있어요.', 'You can add, remove and move blocks afterwards.')}</p>
      <div className="hb-cards">
        {TEMPLATES.map((t) => (
          <button key={t.key} className={`hb-card ${pick === t.key ? 'on' : ''}`} aria-pressed={pick === t.key} onClick={() => setPick(t.key)}>
            <span className="hb-mini" aria-hidden="true">{t.ks.map((k, i) => <i key={i} className={mini(k)} />)}</span>
            <span className="hb-card-tx"><b>{t.name()}</b><div>{t.ks.map((k) => specOf(k).name()).join(' · ')}</div></span>
          </button>
        ))}
      </div>
      <div className="hb-start-foot">
        <button className="tmx-btn pri" onClick={() => onBegin(fromTemplate(pick))}>{tr('이걸로 시작', 'Start with this')}</button>
        <button className="tmx-btn" onClick={() => onBegin(blankHome())}>{tr('빈 판에서', 'From a blank board')}</button>
      </div>
    </section>
  );
}

function AddList({ blocks, onAdd }: { blocks: HomeBlock[]; onAdd: (k: BlockKind) => void }) {
  return (
    <>
      {(['news', 'work'] as const).map((g) => (
        <div key={g}>
          <div className="hb-grp">{g === 'news' ? tr('팀 소식', 'Team news') : tr('우리 일', 'Our work')}</div>
          {BLOCKS.filter((s) => s.group === g).map((s) => (
            <button key={s.k} className="hb-opt" disabled={!canAdd(blocks, s.k)} onClick={() => onAdd(s.k)}>{s.name()}<span>{s.hint()}</span></button>
          ))}
        </div>
      ))}
    </>
  );
}

export function HomeBoard({ teamId, team, icon, people, board, phone, api, renderBlock, modeChoices, nameOf, onWrite, onSaved, Dialog, fallback, below }: {
  teamId: string; team: string; icon?: string; people: number;
  board: Board | null; phone?: boolean; api: HomeApi;
  renderBlock: (b: HomeBlock, editing: boolean) => ReactNode;
  /** 이 기기의 가벼운 모드(데스크톱만) — 모드 칸에 꽂을 것 */
  modeChoices?: ModeChoice[];
  nameOf: (member: string) => string;
  onWrite: () => void;
  onSaved: () => void;
  Dialog: HomeDialog;
  /** 판이 없을 때 — 팀원은 이것만(지금 팀 홈 글 목록), 팀장은 템플릿 셋 아래 */
  fallback: ReactNode;
  /** 판에 글 목록 칸이 없을 때 판 끝에 붙일 글 타일 — 올린 글이 어디에도 안 보이지 않게(공개 이슈 #9) */
  below?: ReactNode;
}) {
  const [draft, setDraft] = useState<Home | null>(null);
  const [past, setPast] = useState<Home[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [quit, setQuit] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const tiles = useRef(new Map<string, HTMLElement>());
  const focusId = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId.current) return;
    tiles.current.get(focusId.current)?.querySelector<HTMLElement>('.hb-grip, .hb-pgrip')?.focus();
    focusId.current = null;
  });

  const saved = board?.home ?? null;
  const home = draft ?? saved;
  const begin = (h: Home) => { setDraft(h); setPast([]); setPreview(null); setErr(''); };
  const commit = (next: Home) => { if (!draft) return; setPast((p) => [...p, draft].slice(-30)); setDraft(next); };
  const blocks = (f: (bs: HomeBlock[]) => HomeBlock[]) => draft && commit({ ...draft, blocks: f(draft.blocks) });
  const leave = () => { setDraft(null); setPast([]); setDrag(null); setAdding(false); setPreview(null); setQuit(false); };
  const dirty = !!draft && !(saved ? homeSame(draft, saved) : false);
  const finish = () => {
    if (!draft) return;
    if (!dirty) return leave();
    setBusy(true);
    void api.save(teamId, draft).then(() => { leave(); onSaved(); }, (e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  };
  const pick = usePick((src) => {
    if (!api.cover || !draft) return;
    setBusy(true);
    void toCover(src).then(async (url) => { const id = await api.cover!(teamId, url); setPreview(url); commit({ ...draft, cover: id }); }).catch((e: unknown) => setErr(String(e))).finally(() => setBusy(false));
  });

  // 끌기 — 처음 자리(rects)로 놓을 자리를 센다(자리 비켜남으로 바뀐 자리를 다시 재지 않는다)
  const down = (e: PointerEvent, id: string) => {
    if (!draft || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rects = draft.blocks.map((b) => { const r = tiles.current.get(b.id)?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 }; });
    setDrag({ id, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, to: draft.blocks.findIndex((b) => b.id === id), rects });
  };
  const move = (e: PointerEvent) => drag && setDrag({ ...drag, dx: e.clientX - drag.sx, dy: e.clientY - drag.sy, to: dropAt(drag.rects, e.clientX, e.clientY) });
  const up = () => { if (!drag) return; const d = drag; setDrag(null); if (d.dx || d.dy) blocks((bs) => moveBlock(bs, d.id, d.to)); };
  const key = (e: KeyboardEvent, id: string, i: number) => {
    const to = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 2 : null;
    if (to === null || !draft || to < 0 || to > draft.blocks.length) return;
    e.preventDefault();
    focusId.current = id;
    blocks((bs) => moveBlock(bs, id, to));
  };
  const from = drag && draft ? draft.blocks.findIndex((b) => b.id === drag.id) : -1;
  const gapAt = drag && drag.to !== from && drag.to !== from + 1 ? drag.to : -1;
  const ref = (id: string) => (el: HTMLElement | null) => { if (el) tiles.current.set(id, el); else tiles.current.delete(id); };
  const grip = (b: HomeBlock, i: number, cls: string) => (
    <button className={cls} aria-label={tr(`${specOf(b.k).name()} 옮기기 — 끌거나 화살표 키`, `Move ${specOf(b.k).name()} — drag or arrow keys`)}
      onPointerDown={(e) => down(e, b.id)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} onKeyDown={(e) => key(e, b.id, i)}><IconGrip /></button>
  );
  const add = (k: BlockKind) => { blocks((bs) => addBlock(bs, k)); setAdding(false); };

  const cover = draft ? preview ?? (draft.cover && draft.cover === saved?.cover ? board?.cover ?? '' : '') : board?.cover ?? '';
  const sub = [home?.blurb, tr(`${people}명`, `${people} people`)].filter(Boolean).join(' · ');
  const style = { '--tc': teamColor(home?.color ?? 0), ...(cover ? { backgroundImage: `url(${cover})` } : {}) } as CSSProperties;

  return (
    <div className={`hb ${phone ? 'phone' : ''} ${draft ? 'editing' : ''}`} style={{ '--tc': teamColor(home?.color ?? 0) } as CSSProperties}>
      {draft && (
        <div className="hb-editbar">
          {tr('꾸미는 중', 'Arranging')}{!phone && <span className="hb-s2">{tr('· 완료를 누르면 팀 모두에게 보여요', '· The team sees it when you press Done')}</span>}
          <span className="hb-sp" />
          <IconButton label={tr('되돌리기', 'Undo')} disabled={!past.length || busy} onClick={() => { setDraft(past.at(-1)!); setPast((p) => p.slice(0, -1)); }}><IconUndo /></IconButton>
          <IconButton label={tr('그만두기', 'Discard')} disabled={busy} onClick={() => (dirty ? setQuit(true) : leave())}><IconClose /></IconButton>
          {/* 팀 모두에게 보이는 일이라 글자 단추 */}
          <button className="tmx-btn pri" disabled={busy} onClick={finish}>{tr('완료', 'Done')}</button>
        </div>
      )}
      <header className={`hb-head ${cover ? 'photo' : ''}`} style={style}>
        <span className="hb-logo"><TeamMarkIcon name={team} size={38} img={icon} /></span>
        <span className="hb-nm"><b>{team}</b><span>{sub}</span></span>
        <span className="hb-sp" />
        {!draft && <IconButton label={tr('글쓰기', 'New post')} onClick={onWrite}><IconPencil /></IconButton>}
        {!draft && board?.owner && saved && <IconButton label={tr('홈 꾸미기', 'Arrange the home')} onClick={() => begin(saved)}><IconDashboard /></IconButton>}
      </header>
      {draft && !phone && (
        <div className="hb-headedit">
          <span className="hb-swatches" role="radiogroup" aria-label={tr('팀 색', 'Team color')}>
            {TEAM_COLORS.map((c, i) => <button key={c} role="radio" aria-checked={draft.color === i} aria-label={tr(`팀 색 ${i + 1}`, `Team color ${i + 1}`)} className={`hb-sw ${draft.color === i ? 'on' : ''}`} style={{ '--c': c } as CSSProperties} onClick={() => commit({ ...draft, color: i })} />)}
          </span>
          <input type="text" aria-label={tr('한 줄 소개', 'One-line intro')} placeholder={tr('한 줄 소개', 'One-line intro')} maxLength={BLURB_MAX} value={draft.blurb}
            onFocus={() => setPast((p) => [...p, draft].slice(-30))} onChange={(e) => setDraft({ ...draft, blurb: e.target.value })} />
          {api.cover && <IconButton tone="line" label={tr('커버 사진', 'Cover photo')} disabled={busy} onClick={pick.open}><IconCamera /></IconButton>}
          {draft.cover && <IconButton tone="line" label={tr('커버 사진 빼기', 'Remove cover photo')} onClick={() => { setPreview(null); commit({ ...draft, cover: '' }); }}><IconTrash /></IconButton>}
          {pick.input}
        </div>
      )}
      <div className="hb-body">
        {err && <div className="hb-err" role="alert">{err}</div>}
        {!home && board?.owner && <Start onBegin={begin} />}
        {!home && fallback}
        {home && !draft && (
          <div className="hb-grid">
            {home.blocks.map((b) => <div key={b.id} className={`hb-b ${b.k} ${b.w === 'full' ? 'full' : ''}`}>{renderBlock(b, false)}</div>)}
            {below && <div className="hb-b posts full">{below}</div>}
          </div>
        )}
        {draft && phone && (
          <div className="hb-prows">
            {draft.blocks.map((b, i) => (
              <div key={b.id}>
                {gapAt === i && <div className="hb-drop" />}
                <div ref={ref(b.id)} className={`hb-prow ${drag?.id === b.id ? 'lift' : ''}`} style={drag?.id === b.id ? { transform: `translateY(${drag.dy}px)` } : undefined}>
                  <b>{specOf(b.k).name()}</b>{b.w === 'half' && <span>{tr('반', 'Half')}</span>}
                  <IconButton label={tr('빼기', 'Remove')} onClick={() => blocks((bs) => removeBlock(bs, b.id))}><IconTrash /></IconButton>
                  {grip(b, i, 'hb-pgrip')}
                </div>
              </div>
            ))}
            {gapAt === draft.blocks.length && <div className="hb-drop" />}
            <button className="hb-add" aria-label={tr('블록 더하기', 'Add a block')} onClick={() => setAdding(true)}><IconPlus /></button>
          </div>
        )}
        {draft && !phone && (
          <div className="hb-grid">
            {draft.blocks.flatMap((b, i) => [
              ...(gapAt === i ? [<div key="gap" className={`hb-drop ${drag && draft.blocks[from]?.w === 'full' ? 'full' : ''}`} />] : []),
              <div key={b.id} ref={ref(b.id)} className={`hb-b ${b.k} ${b.w === 'full' ? 'full' : ''} ${drag?.id === b.id ? 'lift' : ''}`}
                style={drag?.id === b.id ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}>
                {grip(b, i, 'hb-grip')}
                <div className="hb-ctl">
                  {b.k === 'mode' && modeChoices && (
                    <select aria-label={tr('꽂을 모드', 'Mode to place')} value={b.mode ?? ''} onChange={(e) => blocks((bs) => setMode(bs, b.id, e.target.value))}>
                      <option value="">{tr('모드 고르기', 'Pick a mode')}</option>
                      {modeChoices.map((m) => <option key={m.name} value={m.name}>{m.title || m.name}</option>)}
                    </select>
                  )}
                  <IconButton size="s" label={b.w === 'full' ? tr('반 폭으로', 'Half width') : tr('전체 폭으로', 'Full width')} onClick={() => blocks((bs) => setWidth(bs, b.id, b.w === 'full' ? 'half' : 'full'))}>
                    {b.w === 'full' ? <IconWidthNarrow /> : <IconWidthWide />}
                  </IconButton>
                  <IconButton size="s" label={tr('빼기', 'Remove')} onClick={() => blocks((bs) => removeBlock(bs, b.id))}><IconTrash /></IconButton>
                </div>
                {renderBlock(b, true)}
              </div>,
            ])}
            {gapAt === draft.blocks.length && <div className="hb-drop full" />}
            <button className="hb-add full" aria-label={tr('블록 더하기', 'Add a block')} onClick={() => setAdding(true)}><IconPlus /></button>
          </div>
        )}
        {home && !draft && board?.by && saved && <div className="hb-by">{changedLine(nameOf(board.by), saved.at, Date.now())}</div>}
      </div>
      {adding && draft && (phone
        ? <Dialog label={tr('블록 더하기', 'Add a block')} onClose={() => setAdding(false)}><AddList blocks={draft.blocks} onAdd={add} /></Dialog>
        : (
          <aside className="hb-drawer" aria-label={tr('블록 더하기', 'Add a block')}>
            <div className="hb-drawer-h">{tr('블록 더하기', 'Add a block')}<span className="hb-sp" /><IconButton size="s" label={tr('닫기', 'Close')} onClick={() => setAdding(false)}><IconClose /></IconButton></div>
            <AddList blocks={draft.blocks} onAdd={add} />
          </aside>
        ))}
      {quit && <Confirm title={tr('꾸민 것 버리기', 'Discard changes')} body={tr('완료하지 않은 꾸미기를 버려요. 팀 홈은 그대로예요.', "Your unfinished changes go away. The team home stays as it was.")}
        ok={tr('버리기', 'Discard')} danger onCancel={() => setQuit(false)} onOk={leave} />}
    </div>
  );
}

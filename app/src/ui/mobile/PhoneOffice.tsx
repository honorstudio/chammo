// 폰 사무실(시안 docs/design-drafts/office-phone v1 A, 2026-10-23 사용자 "a가 맞는듯") — 방은 데스크톱 OfficeView·draw.ts 그대로, 폭에 꽉 맞춰 통째로.
// 아래 줄 = 사람 필요 → 물어봄 → 일하는 중, 나머지는 한 줄로 접는다. 캐릭터를 누르면 고리 + 그 줄이 맨 위로, 대화 단추로 그 세션 대화.
// 한 화면(시안 office-fit v1 B, 2026-10-24 사용자 "B가 맞다") — 방이 칸을 다 쓰고 세션·뽑기·스킨은 방 위 칩, 누르면 내용만큼(최대 절반) 반 시트.
// 시트가 열리면 방이 남은 칸에 맞춰 줄어 통째로 보이고(참모 고리·캐릭터 누르기 그대로), 참모 줄은 시트 위. 페이지 스크롤 없음.
// 뽑는 연출은 방 위 덮개, 스킨은 방을 밀어 입혀 보고 '이걸로'(phone-gacha v1 B).
// 사무실 v2(시안 office-v2): 방을 옆으로 밀면 다음 사무실(④A), 넓히기 칩, 참모 캐릭터(②B), 편집은 평면도(③C PhoneEdit). 도감·배달 연출은 아직 없음. 모양은 /api/office, 상태는 세션 목록 + 꼬리(/api/tails), 뽑기는 /api/gacha. 메인 묶음이 안 커지게 따로 불러온다(MobileApp lazy)
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { readOffice } from '../../data/web';
import { summarizeTranscript, type Activity } from '../../domain/activity';
import { liveOf, type Live } from '../../domain/agentBrowser';
import { dockLine, noteOf } from '../../domain/dock';
import { phoneName, subStatus } from '../../domain/mobile';
import type { Desk } from '../../domain/office';
import { roomLook } from '../../domain/phoneGacha';
import { expandPrice, LEVELS, MAX_OFFICES } from '../../domain/officeRoom';
import { undecidedOrchs, type GachaFile } from '../../domain/gacha';
import { officeList, parseOffice, phoneRooms, ringOf, talkTargets, tapKind } from '../../domain/phoneOffice';
import { charDot } from '../../domain/spaceOffice';
import { splitOrchName } from '../../domain/orchLabel';
import { speciesFor } from '../../domain/office';
import type { Session } from '../../domain/session';
import { IconBack, IconChat, IconChevron, IconGacha, IconLock, IconPencil, IconPeople, IconSkin } from '../Icons';
import { ownedChars } from '../office/CharPicker';
import { GrowCard, growOverlay, LockCard } from '../office/OfficeRooms';
import { ItemIcon } from '../gacha/GachaPage';
import { Stars } from '../gacha/Stars';
import { PhoneEdit } from './PhoneEdit';
import type { Show } from '../gacha/machine';
import { Face } from '../office/OfficeDock';
import { roomSize } from '../office/draw';
import { OfficeView } from '../office/OfficeView';
import { skinOf } from '../office/skins';
import { SheetHead } from './kit';
import { GachaTab, PlayOverlay, SkinTab, startShow, usePhoneGacha, useSkinPick, type Result } from './PhoneGacha';
import { SessionPeek } from './SessionPeek';
import { useMemoPoll } from './usePoll';
import { useSubTails } from './useSubTails';
import { tr } from '../../i18n';

const dark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

type Sheet = 'sessions' | 'gacha' | 'skin' | 'chars';
// 칩 — 뽑기·스킨은 도트 아이콘(이름은 aria-label·title, 10-24 사용자 "뽑기랑 스킨 아이콘화"), 세션은 개수·사람 필요 점이 붙어 글자 그대로
const SHEETS: [Sheet, string, ReactNode][] = [['sessions', tr('세션', 'Sessions'), null], ['gacha', tr('뽑기', 'Gacha'), <IconGacha />], ['skin', tr('스킨', 'Skins'), <IconSkin />], ['chars', tr('참모 캐릭터', 'Characters'), <IconPeople />]];
/** 열린 반 시트 — 참모를 바꾸면 화면이 그 참모 것으로 다시 그려져(MobileApp OrchSpace key) 여기 남겨 둔다(열린 채 참모를 바꿔도 그대로) */
let keepOpen: Sheet | null = null;
/** 안 정한 참모 캐릭터를 이번 사무실 들어와서 물었나 — 참모를 바꿔도 또 안 묻게, 나갔다 오면 또 묻는다(사용자 11-06) */
let asked = false;
let keepOffice = 0;

export default function PhoneOffice({ sessions, orchs, hqDir, lives, onBack, current, onTalk, onWide }: { sessions: Session[]; orchs: Session[]; hqDir: string; lives: Live[]; onBack: () => void;
  /** 지금 말하는 참모(입력칸 대상) — 방에서 고리 */ current: string; /** 참모를 누름 — 사무실을 안 떠나고 말 상대만 바꾼다 */ onTalk: (id: string) => void;
  /** 뽑기·스킨 시트가 열린 동안 true — MobileApp 이 아래 채팅창을 숨겨 시트가 그만큼 커진다(10-24 사용자 "활성화된 동안 채팅창 사라지면") */ onWide?: (wide: boolean) => void }) {
  const [raw] = useMemoPoll('office', () => readOffice(), 15_000, '{}');
  const shape = useMemo(() => parseOffice(raw), [raw]);
  const tails = useSubTails(sessions);
  const acts = useMemo(() => {
    const m = new Map<string, Activity>();
    for (const [sid, t] of Object.entries(tails)) m.set(sid, summarizeTranscript(t));
    return m;
  }, [tails]);
  const now = Date.now();
  const actOf = (s: Session) => (s.sessionId ? acts.get(s.sessionId) : undefined);
  const g = usePhoneGacha();
  const rooms = phoneRooms({
    sessions, hqDir, shape, actOf,
    ...(g.view?.offices ? { offices: g.view.offices } : {}), ...(g.view?.orchSeats && Object.keys(g.view.orchSeats).length ? { seats: g.view.orchSeats } : {}), ...(g.view?.assign ? { assign: g.view.assign } : {}),
    statusOf: (s) => subStatus(s, tails, now),
    humanOf: (s) => { const a = liveOf(s, lives)?.ask; return a ? a.reason : undefined; },
    labelOf: (s) => phoneName(s.name, orchs),
  });
  const [cur, setCurRaw] = useState(keepOffice);
  const setCur = (i: number) => { keepOffice = i; setCurRaw(i); setGrow(false); };
  const [grow, setGrow] = useState(false);
  const [editing, setEditing] = useState(false);
  const locked = cur >= rooms.length;
  const shapes = g.view?.offices ?? shape.offices;
  const lv = shapes[cur]?.lv ?? 0;
  const next = LEVELS[lv + 1];
  const plain = rooms[cur] ?? { cols: 8, rows: 7, desks: [], door: true, furniture: [] };
  const room = grow && next ? { ...plain, cols: next.cols, rows: next.rows } : plain;
  const allDesks = rooms.flatMap((r) => r.desks);
  // 방 칸 비율 — 칸은 이 비율 높이에서 시작해 시트가 열리면 줄고(mobile.css .m-office-room), 방은 칸 안에 맞춰 그린다(fit box)
  const rs = roomSize(room);
  const [open, setOpenRaw] = useState(keepOpen);
  const setOpen = (t: Sheet | null) => { keepOpen = t; setOpenRaw(t); };
  // 뽑기·스킨은 넓게(채팅창 숨김), 세션 시트는 채팅이 이어져야 해서 그대로. 사무실을 떠나면 거둔다
  const wide = open === 'gacha' || open === 'skin' || open === 'chars';
  useEffect(() => { if (onWide) onWide(open === 'gacha' || open === 'skin' || open === 'chars' || editing); }, [open, onWide, editing]);
  useEffect(() => { if (!onWide) return; return () => onWide(false); }, [onWide]);
  // 장착 반짝 — 방에 '장착!' + 도트 별 1초
  const [equipAt, setEquipAt] = useState(0);
  useEffect(() => { if (!equipAt) return; const t = setTimeout(() => setEquipAt(0), 1000); return () => clearTimeout(t); }, [equipAt]);
  const pick = useSkinPick(g.view, Math.min(cur, Math.max(0, rooms.length - 1)));
  const preview = open === 'skin' ? pick.preview : null;
  // 맥이 쓴 모양 위에 방금 장착(뽑기 답이 office.json 보다 빠르다), 그 위에 입혀 보기
  const look = roomLook(g.view, shape.deco, preview);
  const previewSkin = preview?.slot === 'skin' ? (preview.id ?? 'skin.wood').slice(5) : null;
  const base = cur === 0 ? look.skin ?? shape.skins[0] ?? 'wood' : previewSkin ?? g.view?.offices?.[cur]?.skin ?? shape.skins[cur] ?? 'wood';
  // 다크 모드인데 기본 나무 방이면 밤 방(네온)으로(시안 A 다크) — 고른 스킨은 그대로
  const skin = dark() && base === 'wood' ? 'neon' : base;
  const sk = skinOf(skin);
  const show = useRef<Show | null>(null);
  const [playing, setPlaying] = useState<1 | 10 | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const pull = async (n: 1 | 10) => {
    if (playing) return;
    setResult(null);
    const r = await g.pull(n);
    if (!r?.ok || !r.results) return;
    const rs = r.results;
    show.current = startShow(n, rs, () => { setPlaying(null); setResult({ n, rs }); show.current = null; });
    setPlaying(n);
  };
  // 스킨 탭에선 방을 옆으로 밀면 다음·앞 스킨을 입혀 보고, 그 밖엔 다음·앞 사무실
  const swipe = useRef<number | null>(null);
  const down = (e: PointerEvent) => { swipe.current = e.clientX; };
  const up = (e: PointerEvent) => {
    const x = swipe.current; swipe.current = null;
    if (x === null || Math.abs(e.clientX - x) <= 48) return;
    const d = e.clientX < x ? 1 : -1;
    if (open === 'skin') pick.step(d);
    else { const n = cur + d; if (n >= 0 && n < MAX_OFFICES) setCur(n); }
  };
  const [picked, setPicked] = useState<string | null>(null);
  const [charFor, setCharFor] = useState<string | null>(null);
  const [peek, setPeek] = useState<Session | null>(null);
  const orchIds = orchs.map((o) => o.id);
  const talk = talkTargets(allDesks, orchIds);
  const { rows, rest } = officeList(allDesks, new Set(orchIds));
  const top = picked ? rows.find((d) => d.id === picked) : undefined;
  const list = top ? [top, ...rows.filter((d) => d.id !== top.id)] : rows;
  const need = rows.filter((d) => d.human !== undefined || d.st === 'asks').length;
  // 시트를 바꾸거나 고른 줄이 맨 위로 오면 시트 안도 맨 위로(굴러 내려가 있으면 고른 줄이 안 보인다)
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.scrollTo?.({ top: 0 }); }, [open, picked]);
  const openPeek = (id: string) => { const s = sessions.find((x) => x.id === id); if (s) setPeek(s); };
  // 방에서 누름 — 참모면 그 참모 캐릭터 고르기(11-09 사용자 — 데스크톱과 같은 길, 말 상대는 아래 참모 줄로), 프로젝트 세션이면 고리 + 세션 시트를 열어 그 줄을 맨 위로(다시 누르면 고리만 풂)
  const tap = (id: string) => {
    if (tapKind(id, orchIds) === 'orch') {
      const o = orchs.find((x) => x.id === id);
      setPicked(null);
      if (o && g.view) { setCharFor(splitOrchName(o.name).base); setOpen('chars'); } else onTalk(id);
    } else if (picked === id) setPicked(null);
    else { setPicked(id); setOpen('sessions'); }
  };
  // 참모 캐릭터 — 안 정한 참모가 있으면 사무실 들어올 때 한 번 시트를 연다(곰뿐이면 안 묻는다)
  const orchList = orchs.map((o) => ({ name: splitOrchName(o.name).base, label: phoneName(o.name, orchs) }));
  const viewFile = g.view as unknown as GachaFile | null;
  const undecided = viewFile ? undecidedOrchs(viewFile, orchList.map((o) => o.name)) : [];
  useEffect(() => { if (undecided.length && !asked && !open) { asked = true; setOpen('chars'); } }, [undecided.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const charCur = charFor ?? undecided[0] ?? orchList[0]?.name ?? '';
  const chosen = (name: string) => { const id = g.view?.chars?.[name]; return id && (g.view?.owned[id] ?? 0) > 0 ? id : undefined; };
  const pickChar = (id: string) => {
    void g.office({ op: 'char', name: charCur, id });
    const nx = orchList.find((o) => o.name !== charCur && !chosen(o.name));
    if (nx) setCharFor(nx.name);
  };
  const orchEdit = orchList.map((o) => ({ ...o, spr: shape.sprs[o.name] ?? speciesFor(o.name) }));
  if (editing && !locked && shapes[cur]) return (
    <PhoneEdit g={g} room={shapes[cur]!} seats={g.view?.orchSeats ?? shape.seats} index={cur} skin={skin} deco={look.deco} orchs={orchEdit} plan={plain}
      staff={plain.desks.filter((d) => !d.boss && !d.stand && !orchIds.includes(d.id) && d.w < 2).map((d) => d.spr)} onClose={() => setEditing(false)} />
  );
  const note = (d: Desk) => {
    const s = sessions.find((x) => x.id === d.id);
    const a = s ? actOf(s) : undefined;
    return a?.reply?.ask?.q || noteOf(a?.reply?.say ?? a?.reply?.text);
  };

  return (
    <div className={wide ? 'm-dash m-office m-wide' : 'm-dash m-office'}>
      <header className="m-dash-head">
        <div className="m-dash-row">
          <button type="button" className="m-rt-btn m-ico" onClick={() => { keepOpen = null; asked = false; onBack(); }} aria-label={tr('대시보드로', 'Back to dashboard')} title={tr('대시보드로', 'Back to dashboard')}><IconBack /></button>
          <div className="m-dash-title">{tr('사무실', 'Office')}</div>
        </div>
      </header>
      <div className={open ? 'm-office-stage m-open' : 'm-office-stage'} style={{ background: sk.bg }}>
        <div className="m-office-chips" role="group" aria-label={tr('사무실 칸', 'Office panels')}>
          {SHEETS.filter(([k]) => k !== 'chars' || orchs.length > 0).map(([k, name, icon]) => (
            <button key={k} type="button" aria-expanded={open === k} className={`${icon ? 'm-ico-chip' : ''}${open === k ? ' m-on' : ''}`} onClick={() => setOpen(open === k ? null : k)} aria-label={name} title={name}>
              {icon ?? name}
              {k === 'sessions' && list.length > 0 && <b>{list.length}</b>}
              {k === 'sessions' && need > 0 && <i className="m-talk-dot" aria-hidden />}
              {k === 'chars' && undecided.length > 0 && <i className="m-talk-dot" aria-hidden />}
            </button>
          ))}
          {g.view && !locked && <button type="button" className="m-ico-chip" onClick={() => setEditing(true)} aria-label={tr('꾸미기', 'Decorate')} title={tr('꾸미기', 'Decorate')}><IconPencil /></button>}
          {g.view && !locked && expandPrice(lv) !== null && <button type="button" className={`m-grow-chip${grow ? ' m-on' : ''}`} onClick={() => setGrow((v) => !v)}>{tr(`넓히기 ${expandPrice(lv)!.toLocaleString()}`, `Expand ${expandPrice(lv)!.toLocaleString()}`)}</button>}
        </div>
        <div className={equipAt ? 'm-office-room m-equip' : 'm-office-room'} style={{ aspectRatio: `${rs.W} / ${rs.H}` }} onPointerDown={down} onPointerUp={up}>
          <OfficeView room={room} roomId={cur} overlay={grow ? growOverlay(lv) : undefined} skin={skin} deco={look.deco} fit="box" tags="few" picked={ringOf(picked, current, orchIds)} onOpen={tap} dot={viewFile ? charDot(current, orchs.map((o) => ({ id: o.id, name: splitOrchName(o.name).base })), (n) => !!chosen(n)) : null}
            coins={g.view ? g.view.coins : undefined} onGacha={g.view ? () => setOpen('gacha') : undefined} />
          {open === 'skin' && g.view && (
            <>
              <button type="button" className="m-rt-btn m-ico m-room-arrow m-left" onClick={() => pick.step(-1)} aria-label={tr('앞 스킨 입혀 보기', 'Try previous skin')} title={tr('앞', 'Previous')}><IconChevron /></button>
              <button type="button" className="m-rt-btn m-ico m-room-arrow m-right" onClick={() => pick.step(1)} aria-label={tr('다음 스킨 입혀 보기', 'Try next skin')} title={tr('다음', 'Next')}><IconChevron /></button>
              {preview && <span className="m-room-try">{tr('입혀 보는 중', 'Trying on')}</span>}
            </>
          )}
          {playing && <PlayOverlay show={show} ten={playing === 10} />}
          {locked && <LockCard index={cur} opened={rooms.length} coins={g.view?.coins ?? 0} onOpen={() => void g.office({ op: 'open' })} />}
        </div>
        <div className="m-office-dots" role="tablist" aria-label={tr('사무실', 'Offices')}>
          {Array.from({ length: MAX_OFFICES }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={cur === i} className={cur === i ? 'm-on' : ''} onClick={() => setCur(i)} aria-label={tr(`${i + 1}번 사무실`, `Office ${i + 1}`)}>
              <span>{i < rooms.length ? i + 1 : <IconLock />}{i < rooms.length && (rooms[i]!.short ?? 0) > 0 && <i className="m-talk-dot" aria-hidden />}</span>
            </button>
          ))}
        </div>
        {grow && !locked && <div className="r-grow-slot"><GrowCard lv={lv} coins={g.view?.coins ?? 0} onCancel={() => setGrow(false)} onBuy={() => { void g.office({ op: 'expand', office: cur }); setGrow(false); }} /></div>}
        {/* 참모 줄 — 얼굴만, 지금 말하는 참모만 이름(시안 P). 시트가 열려도 시트 위에 남는다 */}
        {talk.length > 1 && (
          <div className="m-talk" role="tablist" aria-label={tr('말 걸 참모', 'Assistant to talk to')}>
            {talk.map((d) => (
              <button key={d.id} type="button" role="tab" aria-selected={d.id === current} className={d.id === current ? 'm-on' : ''} onClick={() => { setPicked(null); onTalk(d.id); }} aria-label={tr(`${d.label}에게 말하기`, `Talk to ${d.label}`)} title={d.label}>
                <Face spr={d.spr} fill={sk.pets[d.color % sk.pets.length]!} sk={sk} />
                {d.id === current && <span>{d.label}</span>}
                {(d.human !== undefined || d.st === 'asks') && <i className="m-talk-dot" aria-hidden />}
              </button>
            ))}
          </div>
        )}
        {open && (
          <div className="m-office-sheet" role="dialog" aria-label={SHEETS.find(([k]) => k === open)![1]}>
            {/* 작은 폰은 열리면 참모 줄을 숨기고(mobile.css) 머리에 지금 참모 얼굴 하나 */}
            <SheetHead title={<>{talk.filter((d) => d.id === current).map((d) => <span key={d.id} className="m-office-sheet-face" title={d.label}><Face spr={d.spr} fill={sk.pets[d.color % sk.pets.length]!} sk={sk} /></span>)}{SHEETS.find(([k]) => k === open)![1]}</>} onClose={() => setOpen(null)} />
            <div ref={panel} className="m-office-panel">
              {open === 'gacha' && <GachaTab g={g} playing={!!playing} result={result} onPull={(n) => void pull(n)} />}
              {open === 'skin' && <SkinTab g={g} p={pick} dark={dark()} onEquipped={() => setEquipAt(Date.now())} />}
              {open === 'chars' && viewFile && (
                <div className="m-chars">
                  <div className="m-talk" role="tablist" aria-label={tr('참모', 'Assistants')}>
                    {orchList.map((o) => (
                      <button key={o.name} type="button" role="tab" aria-selected={o.name === charCur} className={o.name === charCur ? 'm-on' : ''} onClick={() => setCharFor(o.name)} aria-label={o.label} title={o.label}>
                        {chosen(o.name) ? <ItemIcon id={chosen(o.name)!} size={32} /> : <span className="m-char-none">?</span>}
                        {o.name === charCur && <span>{o.label}</span>}
                      </button>
                    ))}
                  </div>
                  <div className="p-grid">
                    {ownedChars(viewFile).map((c) => (
                      <button key={c.id} type="button" className={`p-chr r-${c.rarity} ${chosen(charCur) === c.id ? 'on' : ''}`} onClick={() => pickChar(c.id)} disabled={g.stalled}>
                        <ItemIcon id={c.id} size={49} />
                        <span className="nm">{c.name.replace(/^.* — /, '')}</span>
                        <Stars count={g.view?.owned[c.id] ?? 0} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {open === 'sessions' && list.length === 0 && rest.length === 0 && <p className="m-muted m-sm m-office-empty">{tr('지금 일하는 세션 없음', 'No sessions working right now')}</p>}
              {open === 'sessions' && <div className="m-office-list">
                {list.map((d) => {
                  const line = dockLine(d.status ?? 'idle', d.act, d.doing, d.human);
                  const human = d.human !== undefined;
                  const text = !human && d.st !== 'working' ? note(d) : line.text;
                  return (
                    <div key={d.id} className={`m-office-row${human ? ' m-hum' : ''}${d.id === picked ? ' m-picked' : ''}`}>
                      <Face spr={d.spr} fill={sk.pets[d.color % sk.pets.length]!} sk={sk} />
                      <span className="m-office-mid">
                        <span><b>{d.label}</b><em className={human ? 'v-hum' : d.st === 'asks' ? 'v-ask' : d.st === 'working' ? 'v-work' : 'v-rest'}>{line.verb}</em></span>
                        {text && <small>{text}</small>}
                      </span>
                      <button type="button" className={d.id === picked ? 'm-rt-btn m-ico m-office-go m-on' : 'm-rt-btn m-ico m-office-go'} onClick={() => openPeek(d.id)} aria-label={tr(`${d.label} 대화로`, `Open ${d.label} chat`)} title={tr('대화로', 'Open chat')}><IconChat /></button>
                    </div>
                  );
                })}
                {rest.length > 0 && <p className="m-muted m-sm m-office-rest">{tr(`쉬는 중 ${rest.length}`, `Idle ${rest.length}`)} — {rest.map((d) => d.label).join(' · ')}</p>}
              </div>}
            </div>
          </div>
        )}
      </div>
      {peek && <SessionPeek s={peek} lives={lives} onClose={() => setPeek(null)} />}
    </div>
  );
}

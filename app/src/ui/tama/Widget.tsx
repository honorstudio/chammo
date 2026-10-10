// 항상 위에 떠 있는 다마고치 창. 계산은 메인 창이 해서 tama.json 에 쓰고, 여기선 읽어서 그리기만 한다.
// 여기서 쓰는 건 알 고르기 하나뿐 — 메인이 1분마다 읽고-계산하고-쓰니 겹칠 틈이 짧다
import { useEffect, useRef, useState } from 'react';
import { readTama, tamaDrag, tamaRequest, tamaWidget, writeTama } from '../../data/tauri';
import { fullness } from '../../domain/tama/pet';
import { MONSTER_NAME, MONSTER_SHORT, monsterWhy, shownMonsters } from '../../domain/tama/monsters';
import { sceneFor } from '../../domain/tama/scene';
import { EMPTY_FILE, parseTamaFile, pickEgg, type TamaFile } from '../../domain/tama/store';
import { nameOf, stageOf, type Egg } from '../../domain/tama/tree';
import { EGGS, STAGES } from './labels';
import { draw, H, iconRect, spriteOf, W } from './lcd';
import { assistant, tr } from '../../i18n';
import { IconMinimize, IconMore } from '../Icons';
import { pressDown, pressMove, type Press } from './press';
import { OrchAvatar } from '../avatar/OrchAvatar';

const DOT = 5;
const TICK_MS = 480;


const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export function Widget() {
  const [file, setFile] = useState<TamaFile>(EMPTY_FILE);
  const [tick, setTick] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(dark() ? 'dark' : 'light');
  const [stats, setStats] = useState(false);
  const [petAt, setPetAt] = useState<number | undefined>();
  const evolved = useRef<{ from: string; until: number } | null>(null);
  const lastSlot = useRef<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // 위젯 어디를 잡아도 끌린다 — 5px 넘게 움직이면 끌기, 그 누르기는 클릭(쓰다듬기·스탯)으로 안 친다
  const press = useRef<Press>(null);
  const onDown = (e: React.MouseEvent) => {
    press.current = e.button === 0 && !(e.target as HTMLElement).closest('button') ? pressDown(e.screenX, e.screenY) : null;
  };
  const onMove = (e: React.MouseEvent) => {
    if (!(e.buttons & 1)) return;
    const r = pressMove(press.current, e.screenX, e.screenY);
    press.current = r.press;
    if (r.startDrag) void tamaDrag();
  };
  const dragged = () => !!press.current?.dragged;

  useEffect(() => {
    const load = () => readTama().then((t) => setFile(parseTamaFile(t))).catch(() => {});
    load();
    const a = setInterval(load, 2000);
    const b = setInterval(() => setTick((t) => t + 1), TICK_MS);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => setTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onTheme);
    return () => { clearInterval(a); clearInterval(b); mq.removeEventListener('change', onTheme); };
  }, []);

  const pet = file.pet;
  const who = pet ? spriteOf(pet.egg, pet.slot) : 'egg';
  // 모습이 바뀐 순간을 잡아 10틱 동안 진화 장면 (처음 읽을 때는 제외)
  if (pet && lastSlot.current !== who) {
    if (lastSlot.current && !pet.dead) evolved.current = { from: lastSlot.current, until: tick + 10 };
    lastSlot.current = who;
  }
  const justEvolved = !!evolved.current && tick < evolved.current.until;
  const foe = shownMonsters(file.monsters)[0];
  const { scene, lit } = sceneFor(pet, Date.now(), { busy: !!file.busy, justEvolved, monster: !!foe });

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== W * DOT * dpr) { c.width = W * DOT * dpr; c.height = H * DOT * dpr; }
    draw(c, { scene, lit, who, prev: evolved.current?.from, petAt, foe: foe && `mon_${foe.kind}` }, tick, theme);
  });

  const onScreen = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragged()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    const s = iconRect('stat');
    if (x >= s.x - 1 && x < s.x + s.w + 1 && y >= s.y - 1 && y < s.y + s.h + 1) setStats((v) => !v);
    else setPetAt(tick); // 화면 아무 데나 = 쓰다듬기
  };

  const choose = async (egg: Egg) => {
    const f = parseTamaFile(await readTama());
    const next = pickEgg(f, egg, Date.now(), Math.random());
    await writeTama(JSON.stringify(next));
    setFile(next);
  };

  const days = pet ? Math.floor((Date.now() - pet.bornAt) / 86_400_000) + 1 : 0;
  const needEgg = !pet || !!pet.dead;
  // 은퇴한 뒤 빈자리 — 다음 세대 알(버릇을 물려받는다)
  const gen = (file.lineage?.length ?? 0) + 1;
  const retired = !pet ? file.lineage?.[file.lineage.length - 1] : undefined;

  return (
    <div className={`tw ${theme}`} onMouseDown={onDown} onMouseMove={onMove}>
      <div className="tw-screen">
        <canvas ref={canvas} style={{ width: W * DOT, height: H * DOT }} onClick={onScreen} />
        {needEgg && (
          <div className="tw-over">
            <b>{pet?.dead ? tr(`${nameOf(pet.egg, pet.dead.slot)} — 떠났어. 새 알을 골라줘`, `${nameOf(pet.egg, pet.dead.slot)} has left. Pick a new egg`) : retired ? tr(`${nameOf(retired.egg, retired.slot)} 은퇴 — ${gen}대 알을 골라줘`, `${nameOf(retired.egg, retired.slot)} retired — pick the Gen ${gen} egg`) : tr('알을 골라줘', 'Pick an egg')}</b>
            {EGGS.map(([egg, name, like]) => (
              <button key={egg} onClick={() => void choose(egg)}><b>{name}</b><span>{tr('좋아하는 것', 'Likes')}: {like}</span></button>
            ))}
          </div>
        )}
        {stats && pet && !needEgg && (
          <div className="tw-over" onClick={() => { if (!dragged()) setStats(false); }}>
            <b>{nameOf(pet.egg, pet.slot)} · {STAGES[stageOf(pet.slot)]}</b>
            <span>{tr(`${days}일째`, `Day ${days}`)} · {tr('배', 'Belly')} {'●'.repeat(fullness(pet))}{'○'.repeat(4 - fullness(pet))}</span>
            <span>{tr('돌봄 실수', 'Care mistakes')} {pet.c.mistakes} · {tr('훈련', 'Training')} {pet.c.training} · {tr('과식', 'Overfed')} {pet.c.overfeed}</span>
            <span>{tr(`배틀 ${pet.c.wins}승 / ${pet.c.battles}판`, `Battles ${pet.c.wins}W / ${pet.c.battles}`)} · PR {pet.c.prMerges} · {tr('시킨 일', 'Tasks')} {pet.c.tasksDone}</span>
            <span>{tr('평생 커밋', 'Lifetime commits')} {pet.life.commits} · {tr('진화', 'Evolutions')} {file.dex.length}</span>
            <button onClick={(e) => { e.stopPropagation(); setStats(false); void tamaRequest('pet'); }}>{tr('진화 · 보관함 열기', 'Open evolutions and storage')}</button>
            <span className="dim">{tr('빈 곳을 누르면 닫힘', 'Click anywhere to close')}</span>
          </div>
        )}
      </div>
      <div className="tw-bar">
        {file.keeper && <span className="tw-keeper" title={tr(`돌보는 ${assistant()} — ${file.keeper.name}`, `Caretaker — ${file.keeper.name}`)}><OrchAvatar name={file.keeper.name} size={18} state={file.busy ? 'work' : 'rest'} color={file.keeper.color} /></span>}
        <b>{pet && !pet.dead ? nameOf(pet.egg, pet.slot) : tr('다마고치', 'Pet')}</b>
        {foe && pet && !pet.dead
          ? <span className="dim" title={`${MONSTER_NAME[foe.kind]()} — ${monsterWhy(foe)}`}>{MONSTER_SHORT[foe.kind]()} Lv.{foe.lv}</span>
          : <span className="dim">{pet && !pet.dead ? STAGES[stageOf(pet.slot)] : ''}</span>}
        <span className="sp" />
        <button className="tw-ic" onClick={() => void tamaRequest('pet')} aria-label={tr('더보기 — 도감·보관함', 'More — collection & storage')} title={tr('더보기 — 도감·보관함', 'More — collection & storage')}><IconMore /></button>
        <button className="tw-ic" onClick={() => void tamaWidget(false)} aria-label={tr('숨기기 — 상단 바로', 'Hide — to the top bar')} title={tr('숨기기 — 상단 바로', 'Hide — to the top bar')}><IconMinimize /></button>
      </div>
    </div>
  );
}

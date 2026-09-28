// 항상 위에 떠 있는 다마고치 창. 계산은 메인 창이 해서 tama.json 에 쓰고, 여기선 읽어서 그리기만 한다.
// 여기서 쓰는 건 알 고르기 하나뿐 — 메인이 1분마다 읽고-계산하고-쓰니 겹칠 틈이 짧다
import { useEffect, useRef, useState } from 'react';
import { readTama, tamaDrag, tamaWidget, writeTama, tamaMore } from '../../data/tauri';
import { fullness } from '../../domain/tama/pet';
import { sceneFor } from '../../domain/tama/scene';
import { EMPTY_FILE, parseTamaFile, pickEgg, type TamaFile } from '../../domain/tama/store';
import { nameOf, stageOf, type Egg } from '../../domain/tama/tree';
import { EGGS, STAGES } from './labels';
import { draw, H, iconRect, spriteOf, W } from './lcd';
import { tr } from '../../i18n';

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
  const { scene, lit } = sceneFor(pet, Date.now(), { busy: !!file.busy, justEvolved });

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== W * DOT * dpr) { c.width = W * DOT * dpr; c.height = H * DOT * dpr; }
    draw(c, { scene, lit, who, prev: evolved.current?.from, petAt }, tick, theme);
  });

  const onScreen = (e: React.MouseEvent<HTMLCanvasElement>) => {
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

  return (
    <div className={`tw ${theme}`}>
      <div className="tw-screen">
        <canvas ref={canvas} style={{ width: W * DOT, height: H * DOT }} onClick={onScreen} />
        {needEgg && (
          <div className="tw-over">
            <b>{pet?.dead ? tr(`${nameOf(pet.egg, pet.dead.slot)} — 떠났어. 새 알을 골라줘`, `${nameOf(pet.egg, pet.dead.slot)} has left. Pick a new egg`) : tr('알을 골라줘', 'Pick an egg')}</b>
            {EGGS.map(([egg, name, like]) => (
              <button key={egg} onClick={() => void choose(egg)}><b>{name}</b><span>{tr('좋아하는 것', 'Likes')}: {like}</span></button>
            ))}
          </div>
        )}
        {stats && pet && !needEgg && (
          <div className="tw-over" onClick={() => setStats(false)}>
            <b>{nameOf(pet.egg, pet.slot)} · {STAGES[stageOf(pet.slot)]}</b>
            <span>{tr(`${days}일째`, `Day ${days}`)} · {tr('배', 'Belly')} {'●'.repeat(fullness(pet))}{'○'.repeat(4 - fullness(pet))}</span>
            <span>{tr('돌봄 실수', 'Care mistakes')} {pet.c.mistakes} · {tr('훈련', 'Training')} {pet.c.training} · {tr('과식', 'Overfed')} {pet.c.overfeed}</span>
            <span>{tr(`배틀 ${pet.c.wins}승 / ${pet.c.battles}판`, `Battles ${pet.c.wins}W / ${pet.c.battles}`)} · PR {pet.c.prMerges} · {tr('시킨 일', 'Tasks')} {pet.c.tasksDone}</span>
            <span>{tr('평생 커밋', 'Lifetime commits')} {pet.life.commits} · {tr('도감', 'Dex')} {file.dex.length}</span>
            <button onClick={(e) => { e.stopPropagation(); setStats(false); void tamaMore(); }}>{tr('도감 · 보관함 열기', 'Open dex and storage')}</button>
            <span className="dim">{tr('빈 곳을 누르면 닫힘', 'Click anywhere to close')}</span>
          </div>
        )}
      </div>
      <div className="tw-bar" onMouseDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName !== 'BUTTON') void tamaDrag(); }}>
        <b>{pet && !pet.dead ? nameOf(pet.egg, pet.slot) : tr('다마고치', 'Pet')}</b>
        <span className="dim">{pet && !pet.dead ? STAGES[stageOf(pet.slot)] : ''}</span>
        <span className="sp" />
        <button onClick={() => void tamaMore()} title={tr('도감·보관함 — 다마고치 창으로', 'Dex and storage — in the pet window')}>{tr('더보기', 'More')}</button>
        <button onClick={() => void tamaWidget(false)}>{tr('숨기기', 'Hide')}</button>
      </div>
    </div>
  );
}

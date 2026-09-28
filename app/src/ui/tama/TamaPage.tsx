// 메인 창 "다마고치" 페이지: 지금 키우는 애 · 도감(계열별 17칸) · 보관함(3칸, 시간 멈춤) · 무덤 · 처음부터
import { useEffect, useRef, useState } from 'react';
import { BADGES } from '../../domain/tama/badges';
import { fullness } from '../../domain/tama/pet';
import { archive, BOX_SIZE, fuse, restart, retrieve, type TamaFile } from '../../domain/tama/store';
import { fuseTarget, nameOf, stageOf, type Egg, type Slot } from '../../domain/tama/tree';
import { EGGS, eggName, STAGES } from './labels';
import { drawSprite, spriteOf } from './lcd';
import { getLang, tr } from '../../i18n';

const SLOTS: Slot[] = ['egg', 'i1', 'i2', 'r1', 'r2', 'cG', 'cD', 'cA', 'cT', 'cM', 'cS', 'cN', 'cX', 'p1', 'p2', 'p3', 'm1', 'm2'];
/** 합체 궁극체 — 어느 계열 쪽으로 봤든 한 칸 */
const FUSED: [Slot, Egg, string][] = [['jA', 'fire', `${nameOf('fire', 'p1')} + ${nameOf('wave', 'p1')}`], ['jB', 'leaf', `${nameOf('leaf', 'p1')} + ${nameOf('star', 'p1')}`]];
const TOTAL = EGGS.length * SLOTS.length + FUSED.length;
const theme = () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const day = (t: number) => new Date(t).toLocaleDateString(getLang() === 'en' ? 'en-US' : 'ko-KR', { month: 'numeric', day: 'numeric' });

function Sprite({ egg, slot, size }: { egg: Egg; slot: Slot; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = c.height = Math.round(size * (window.devicePixelRatio || 1));
    drawSprite(c, spriteOf(egg, slot), theme());
  }, [egg, slot, size]);
  return <canvas ref={ref} className="tp-lcd" style={{ width: size, height: size }} />;
}

type Props = { file: TamaFile | null; apply: (op: (f: TamaFile, now: number) => TamaFile | null) => Promise<boolean> };

export function TamaPage({ file, apply }: Props) {
  const [sure, setSure] = useState(false); // 처음부터: 두 번 눌러야
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
  if (!file) return <div className="empty"><b>{tr('다마고치 불러오는 중…', 'Loading your pet…')}</b></div>;
  const pet = file.pet && !file.pet.dead ? file.pet : null;
  const seen = new Set(file.dex);

  const act = async (op: (f: TamaFile, now: number) => TamaFile | null, fail: string) => setMsg((await apply(op)) ? null : fail);

  return (
    <div className="tp">
      <section className="tp-now">
        {pet ? (
          <>
            <Sprite egg={pet.egg} slot={pet.slot} size={96} />
            <div className="tp-info">
              <b>{nameOf(pet.egg, pet.slot)}</b>
              <span className="dim">{eggName(pet.egg)} · {STAGES[stageOf(pet.slot)]} · {tr(`${Math.floor((Date.now() - pet.bornAt) / 86_400_000) + 1}일째`, `Day ${Math.floor((Date.now() - pet.bornAt) / 86_400_000) + 1}`)}</span>
              <span>{tr('배', 'Belly')} {'●'.repeat(fullness(pet))}{'○'.repeat(4 - fullness(pet))} · {tr('돌봄 실수', 'Care mistakes')} {pet.c.mistakes} · {tr('훈련', 'Training')} {pet.c.training} · {tr('과식', 'Overfed')} {pet.c.overfeed}</span>
              <span>{tr(`배틀 ${pet.c.wins}승 / ${pet.c.battles}판`, `Battles ${pet.c.wins}W / ${pet.c.battles}`)} · PR {pet.c.prMerges} · {tr('시킨 일', 'Tasks')} {pet.c.tasksDone} · {tr('평생 커밋', 'Lifetime commits')} {pet.life.commits}</span>
              {pet.sick && <span className="warn">{tr('아파 — 커밋 3개가 약', 'Sick — 3 commits are the cure')}</span>}
            </div>
            <span className="sp" />
            <div className="tp-acts">
              <button className="btn" disabled={file.box.length >= BOX_SIZE} onClick={() => void act(archive, tr('보관함이 꽉 찼어', 'Storage is full'))}>{tr('보관함에 넣기', 'Put in storage')}</button>
              <button className={`btn ${sure ? 'danger' : ''}`} onClick={() => (sure ? void act(restart, '').then(() => setSure(false)) : setSure(true))}>
                {sure ? tr('정말 떠나보낼까? 한 번 더', 'Really let it go? Click again') : tr('처음부터', 'Start over')}
              </button>
            </div>
          </>
        ) : (
          <div className="tp-info"><b>{file.pet?.dead ? tr(`${nameOf(file.pet.egg, file.pet.dead.slot)} — 떠났어`, `${nameOf(file.pet.egg, file.pet.dead.slot)} — has left`) : tr('키우는 애가 없어', 'No pet right now')}</b><span className="dim">{tr('위젯에서 알을 골라줘', 'Pick an egg in the widget')}</span></div>
        )}
      </section>
      {msg && <div className="banner">{msg}</div>}

      <h3>{tr('업적', 'Achievements')} <span className="dim">{Object.keys(file.badges ?? {}).length} / {BADGES.length}</span></h3>
      <div className="tp-badges">
        {BADGES.map((b) => {
          const at = file.badges?.[b.id];
          return (
            <div key={b.id} className={`tp-badge ${at ? 'on' : ''}`} title={b.hint}>
              <b>{b.name}</b>
              <span>{at ? tr(`${day(at)} 달성`, `Earned ${day(at)}`) : b.hint}</span>
            </div>
          );
        })}
      </div>

      <h3>{tr('보관함', 'Storage')} <span className="dim">{file.box.length} / {BOX_SIZE} — {tr('넣어 둔 동안은 시간이 멈춰', 'time stops while stored')}</span></h3>
      <div className="tp-box">
        {Array.from({ length: BOX_SIZE }, (_, i) => file.box[i]).map((b, i) =>
          b ? (
            <div key={i} className="tp-slot">
              <Sprite egg={b.egg} slot={b.slot} size={56} />
              <div className="tp-info"><b>{nameOf(b.egg, b.slot)}</b><span className="dim">{STAGES[stageOf(b.slot)]} · {tr(`${day(b.boxedAt)} 넣음`, `stored ${day(b.boxedAt)}`)}</span></div>
              {pet && fuseTarget(pet, b) && (
                <button className="btn pri" onClick={() => void act((f, now) => fuse(f, i, now), tr('합체하지 못했어', 'Could not fuse'))}>{tr('합체', 'Fuse')}</button>
              )}
              <button className="btn" onClick={() => void act((f, now) => retrieve(f, i, now), tr('꺼내지 못했어', 'Could not take it out'))}>{pet ? tr('바꾸기', 'Swap') : tr('꺼내기', 'Take out')}</button>
            </div>
          ) : (
            <div key={i} className="tp-slot empty-slot">{tr('빈 칸', 'Empty')}</div>
          ),
        )}
      </div>

      <h3>{tr('도감', 'Dex')} <span className="dim">{tr('본 모습', 'Seen')} {new Set(file.dex.map((d) => (d.endsWith('.jA') || d.endsWith('.jB') ? d.slice(-2) : d))).size} / {TOTAL} — {tr('한 번 본 모습만 그림이 보여', 'only forms you have met are shown')}</span></h3>
      {EGGS.map(([egg, name]) => (
        <div key={egg} className="tp-line">
          <div className="tp-line-name">{name} <span className="dim">{SLOTS.filter((s) => seen.has(`${egg}.${s}`)).length} / {SLOTS.length}</span></div>
          <div className="tp-dex">
            {SLOTS.map((s) => (
              <div key={s} className="tp-cell" title={seen.has(`${egg}.${s}`) ? `${nameOf(egg, s)} · ${STAGES[stageOf(s)]}` : STAGES[stageOf(s)]}>
                {seen.has(`${egg}.${s}`) ? <Sprite egg={egg} slot={s} size={44} /> : <div className="tp-unknown">???</div>}
                <span>{seen.has(`${egg}.${s}`) ? nameOf(egg, s) : '???'}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="tp-line">
        <div className="tp-line-name">{tr('합체', 'Fusion')} <span className="dim">{tr("보관함의 완전체와 키우는 완전체가 짝이면 보관함 칸에 '합체'가 뜬다", "When your Perfect matches a stored Perfect, 'Fuse' appears on its storage slot")}</span></div>
        <div className="tp-dex">
          {FUSED.map(([s, egg, how]) => {
            const got = file.dex.some((d) => d.endsWith(`.${s}`));
            return (
              <div key={s} className="tp-cell" title={how}>
                {got ? <Sprite egg={egg} slot={s} size={44} /> : <div className="tp-unknown">???</div>}
                <span>{got ? nameOf(egg, s) : '???'}</span>
              </div>
            );
          })}
        </div>
      </div>

      <h3>{tr('무덤', 'Graves')} <span className="dim">{file.graves.length}</span></h3>
      {file.graves.length === 0 ? (
        <p className="dim">{tr('아직 없어', 'None yet')}</p>
      ) : (
        <div className="tp-graves">
          {[...file.graves].reverse().map((g, i) => (
            <div key={i} className="tp-grave">
              <b>{nameOf(g.egg, g.slot)}</b>
              <span className="dim">{eggName(g.egg)} · {STAGES[stageOf(g.slot)]} · {day(g.bornAt)} ~ {day(g.diedAt)} · {g.left ? tr('떠나보냄', 'Let go') : tr('4일 무활동', '4 days inactive')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 장애 몬스터 화면 — 지금 나온 것(펫 모달 위쪽)과 '몬스터' 탭(잡은 도감·최근 기록). docs/design-drafts/tama-next v1 D
import { coinsOf, MONSTER_HOW, MONSTER_NAME, monsterWhy, shownMonsters, type MonsterKind, type Monsters } from '../../domain/tama/monsters';
import { getLang, tr } from '../../i18n';
import { Sprite } from './Sprite';

const KINDS: MonsterKind[] = ['slime', 'ghost', 'golem'];
const when = (t: number) => new Date(t).toLocaleString(getLang() === 'en' ? 'en-US' : 'ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const ago = (ms: number) => { const h = Math.floor(ms / 3_600_000); return h < 1 ? tr(`${Math.max(1, Math.floor(ms / 60_000))}분째`, `${Math.max(1, Math.floor(ms / 60_000))}m`) : h < 48 ? tr(`${h}시간째`, `${h}h`) : tr(`${Math.floor(h / 24)}일째`, `${Math.floor(h / 24)}d`); };

/** 지금 나온 몬스터 — 없으면 안 그린다 */
export function MonsterNow({ monsters, now }: { monsters?: Monsters; now: number }) {
  const shown = shownMonsters(monsters);
  if (!shown.length) return null;
  return (
    <section className="pv-mon">
      <div className="pv-h">{tr('장애 몬스터', 'Trouble monsters')}<span>{shown.length}</span></div>
      <ul>
        {shown.map((m) => (
          <li key={m.id}>
            <Sprite name={`mon_${m.kind}`} size={36} />
            <div className="pv-name"><b>{MONSTER_NAME[m.kind]()} Lv.{m.lv}</b><span>{monsterWhy(m)} · {ago(now - m.since)}</span></div>
            <span className="pv-mon-how" title={MONSTER_HOW[m.kind]()}>{MONSTER_HOW[m.kind]()} · +{coinsOf(m.lv)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** '몬스터' 탭 — 종류마다 잡은 수, 그 아래 최근 기록 */
export function MonsterTab({ monsters }: { monsters?: Monsters }) {
  const log = monsters?.log ?? [];
  const won = (k: MonsterKind) => log.filter((l) => l.kind === k && !l.fled).length;
  return (
    <div className="pv-mons">
      <div className="pv-mon-dex">
        {KINDS.map((k) => (
          <div key={k} className={`pv-mon-kind ${won(k) ? '' : 'off'}`} title={MONSTER_HOW[k]()}>
            {won(k) ? <Sprite name={`mon_${k}`} size={48} /> : <span className="pv-cell off" />}
            <b>{won(k) ? MONSTER_NAME[k]() : '???'}</b>
            <span>{tr(`${won(k)}마리 처치`, `${won(k)} beaten`)}</span>
          </div>
        ))}
      </div>
      {log.length === 0 ? <div className="pv-blank">{tr('아직 만난 몬스터가 없어 — CI 연속 빨강·멈춘 세션·오래 열린 PR 이 나타나면 여기 남아', 'No monsters yet — red CI streaks, stuck sessions and stale PRs show up here')}</div> : (
        <ul className="pv-graves">
          {[...log].reverse().slice(0, 20).map((l, i) => (
            <li key={i}><b>{MONSTER_NAME[l.kind]()} Lv.{l.lv}</b><span>{l.where} · {when(l.end)} · {l.fled ? tr('도망감', 'Got away') : tr(`처치 +${coinsOf(l.lv)}`, `Beaten +${coinsOf(l.lv)}`)}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

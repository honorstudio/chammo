// 참모 캐릭터 고르기(시안 office-v2 ②B 한 창에 전부) — 왼쪽 참모 줄, 오른쪽 가진 캐릭터 칸. 고르면 다음 안 정한 참모로. 닫으면 그동안 랜덤, 다음에 사무실 들어올 때 또 묻는다
import { useState } from 'react';
import { CATALOG, itemOf, undecidedOrchs, type GachaFile, type Rarity } from '../../domain/gacha';
import { tr } from '../../i18n';
import { ItemIcon } from '../gacha/GachaPage';
import { Stars } from '../gacha/Stars';
import { OfficeModal, SubHead } from './OfficeMenu';

const ORDER: Rarity[] = ['전설', '희귀', '보통', '흔함'];
const short = (id: string) => itemOf(id)?.name.replace(/^.* — /, '') ?? '';
/** 가진 캐릭터 — 좋은 등급부터 */
export const ownedChars = (f: GachaFile) => CATALOG.filter((c) => c.kind === 'chr' && (f.owned[c.id] ?? 0) > 0).sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity));

export type PickOrch = { name: string; label: string; role?: string };

export function CharPicker({ file, orchs, first, onPick, onClose }: { file: GachaFile; orchs: PickOrch[]; /** 처음 고를 참모 */ first?: string; onPick: (name: string, id: string) => void; onClose: () => void }) {
  const chosen = (name: string) => { const id = file.chars?.[name]; return id && (file.owned[id] ?? 0) > 0 ? id : undefined; };
  const [cur, setCur] = useState(() => first ?? orchs.find((o) => !chosen(o.name))?.name ?? orchs[0]?.name ?? '');
  const rest = orchs.filter((o) => !chosen(o.name)).length;
  const pick = (id: string) => {
    onPick(cur, id);
    const next = orchs.find((o) => o.name !== cur && !chosen(o.name));
    if (next) setCur(next.name);
  };
  return (
    <div className="office-sub pick">
      <SubHead onClose={onClose} title={<>{tr('참모 캐릭터 정하기', 'Pick characters')}<span className="pick-left">{rest ? tr(`${rest}명 남음`, `${rest} left`) : tr('다 정했어', 'All set')}</span></>} />
      <div className="pick-body">
        <div className="pb-list">
          {orchs.map((o) => {
            const id = chosen(o.name);
            return (
              <button key={o.name} type="button" className={`pb-row ${o.name === cur ? 'on' : ''}`} onClick={() => setCur(o.name)}>
                <div className={`pb-face ${id ? '' : 'none'}`}>{id ? <ItemIcon id={id} size={42} /> : '?'}</div>
                <div><b>{o.label}</b>{o.role && <span>{o.role}</span>}</div>
              </button>
            );
          })}
        </div>
        <div className="p-grid">
          {ownedChars(file).map((c) => {
            const by = orchs.find((o) => o.name !== cur && chosen(o.name) === c.id);
            return (
              <button key={c.id} type="button" className={`p-chr r-${c.rarity} ${chosen(cur) === c.id ? 'on' : ''}`} title={by ? tr(`${short(c.id)} — ${by.label} 쓰는 중`, `${short(c.id)} — used by ${by.label}`) : short(c.id)} onClick={() => pick(c.id)}>
                <ItemIcon id={c.id} size={56} />
                <span className="nm">{short(c.id)}</span>
                <Stars count={file.owned[c.id] ?? 0} />
                {by && <span className="p-used"><ItemIcon id={c.id} size={16} /></span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * 사무실에 들어왔을 때 안 정한 참모가 있으면 띄운다(곰뿐이면 안 묻는다). 닫으면 이번엔 그만 — 사무실을 다시 열면(붙을 때마다) 또 묻는다.
 * open = 꾸미기에서 직접 열었거나 방에서 참모를 눌렀을 때(first = 그 참모)
 */
export function CharGate({ file, orchs, open, first, onPick, onClose }: { file: GachaFile; orchs: PickOrch[]; open: boolean; /** 방에서 누른 참모 — 그 참모부터 */ first?: string; onPick: (name: string, id: string) => void; onClose: () => void }) {
  const [closed, setClosed] = useState(false);
  const undecided = undecidedOrchs(file, orchs.map((o) => o.name));
  if (!open && (closed || !undecided.length)) return null;
  return (
    <OfficeModal onClose={() => { setClosed(true); onClose(); }}>
      <CharPicker key={first ?? ''} file={file} orchs={orchs} first={first} onPick={onPick} onClose={() => { setClosed(true); onClose(); }} />
    </OfficeModal>
  );
}

// 다른 기기 보기(peer-panel) 부품 — 띠 맨 위 기기 단추·기기 목록·맨 위 '보는 중' 줄·그 기기 띠. 상태는 Far.tsx(useFarMode)
import { useEffect, useRef, useState } from 'react';
import { remoteDevices, type RemoteDevice } from '../../data/remote';
import type { FarDot, FarSession } from '../../domain/farHome';
import { josa, machine, tr } from '../../i18n';
import { OrchAvatar, orchColor } from '../avatar';
import { IconDevice } from '../Icons';
import type { FarTarget } from './Far';
import './far.css';

export const avState = (d: FarDot) => (d === 'run' ? 'work' : d === 'ask' ? 'ask' : 'rest');

export function FarButton({ far, wait, open, onClick }: { far?: boolean; wait?: boolean; open?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button className={`far-btn ${far ? 'far' : ''} ${open ? 'open' : ''}`} onClick={onClick} aria-label={tr('기기', 'Devices')} aria-expanded={open} data-tip={tr('기기', 'Devices')} data-tip-key="⌘⇧D">
      <IconDevice />{wait && <i className="far-wait" aria-hidden="true" />}
    </button>
  );
}

/** 기기 목록 — 열 때 테일넷을 한 번 묻는다(그 동안은 짝지은 이름만) */
export function FarPop({ saved, cur, waitDevs, onPick, onHere, onClose, onConnect }: {
  saved: { id: string; name: string }[]; cur: string | null; waitDevs: Set<string>;
  onPick: (d: FarTarget, status: RemoteDevice | undefined) => void; onHere: () => void; onClose: () => void; onConnect: () => void;
}) {
  const [devs, setDevs] = useState<RemoteDevice[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { void remoteDevices().then((o) => setDevs(o.devices), () => setDevs([])); }, []);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.far-btn')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key); };
  }, [onClose]);
  const rows = saved.map((s) => ({ s, d: devs?.find((x) => x.id === s.id) }));
  const sub = (d: RemoteDevice | undefined) => {
    if (!devs) return tr('찾는 중…', 'Looking…');
    if (!d || d.status === 'offline') return tr('연결 끊김', 'Not reachable');
    if (d.status === 'pair') return tr('다시 연결 필요', 'Needs reconnecting');
    const os = d.os ? `${/win/i.test(d.os) ? tr('윈도우', 'Windows') : tr('맥', 'Mac')} · ` : '';
    return d.old ? `${os}${tr('업데이트 필요', 'Needs update')}` : `${os}${tr('연결됨', 'Connected')}${d.version ? ` · ${d.version}` : ''}`;
  };
  return (
    <div className="far-pop" ref={box} role="menu" aria-label={tr('기기', 'Devices')}>
      <button className={`far-it ${cur ? '' : 'on'}`} role="menuitem" onClick={onHere}><span className="far-tx"><b>{tr(`이 ${machine()}`, `This ${machine()}`)}</b></span></button>
      <i className="far-hr" />
      {rows.map(({ s, d }) => (
        <button key={s.id} role="menuitem" className={`far-it ${cur === s.id ? 'on' : ''} ${devs && (!d || d.status !== 'connected') ? 'dim' : ''}`} onClick={() => onPick({ dev: s.id, name: d?.name || s.name }, d)}>
          <span className="far-tx"><b>{d?.name || s.name}</b><span>{sub(d)}</span></span>
          {waitDevs.has(s.id) && <i className="far-dot d-ask" aria-label={tr('결정 대기', 'Waiting for you')} />}
        </button>
      ))}
      <i className="far-hr" />
      <button className="far-it small" role="menuitem" onClick={onConnect}><span className="far-tx"><span>{tr('기기 연결…', 'Connect a device…')}</span></span></button>
    </div>
  );
}

/** 맨 위 전체 폭 줄 — '<기기> 보는 중' + 이 맥으로(왼쪽 색 띠 대신 면 색) */
export function FarBar({ name, cut, onBack }: { name: string; cut: boolean; onBack: () => void }) {
  return (
    <div className={`far-bar ${cut ? 'cut' : ''}`} role="status">
      <IconDevice />
      <b>{cut ? tr(`${name} · 연결 끊김`, `${name} · not reachable`) : tr(`${name} 보는 중`, `Viewing ${name}`)}</b>
      {!cut && <span className="far-bar-sub">{tr('보내는 말은 사람 말로, 파일은 읽기만', 'What you send goes as you; files are read-only')}</span>}
      <span className="far-sp" />
      <button className="far-back" onClick={onBack}>{tr(`이 ${josa(machine(), "으로", "로")}`, `Back to this ${machine()}`)}</button>
    </div>
  );
}

export function FarRail({ button, assistants, on, onPick }: { button: React.ReactNode; assistants: FarSession[]; on: string | null; onPick: (a: FarSession) => void }) {
  return (
    <nav className="lk-strip far-strip" aria-label={tr('그 기기 참모', 'Assistants on that device')}>
      {button}
      <i className="far-sep" />
      {assistants.map((a) => (
        <button key={a.id} className={`lk-av ${on === a.id ? 'on' : ''}`} style={{ ['--orch-solid' as string]: orchColor(a.name) }} onClick={() => onPick(a)} aria-label={a.name} aria-current={on === a.id || undefined} data-tip={a.name}>
          <span className="lk-av-pic"><OrchAvatar name={a.name} size={32} state={avState(a.dot)} color={orchColor(a.name)} label={a.name} />{a.dot !== 'rest' && <i className={`lk-pip p-${a.dot === 'ask' ? 'ask' : 'run'}`} aria-hidden="true" />}</span>
        </button>
      ))}
    </nav>
  );
}


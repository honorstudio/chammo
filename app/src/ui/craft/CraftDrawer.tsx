// 앱 서랍(2026-10-17 사용자 '앱 서랍' — v3 덱 1, 런치패드처럼) — 스페이스 탭 줄 격자 아이콘을 누르면 이 칸.
// 13개 앱 아이콘 격자(아이콘 아래 이름 한 줄, 판·크기·마지막 사용은 올리면): 깔린 것은 누르면 열고, 안 깐 것은 흐리게 + '받기' — 누르면 설치 뒤 열기.
// 지우기는 우리가 깐 것만(마우스 올리면 휴지통 · 오른쪽 클릭), 한 번 묻고. 연 앱은 독 규칙대로 탭 줄에 붙는다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { tr } from '../../i18n';
import { sizeText, splitRows, tileCorner, tileIcon, tileLetter, tileLoading, tileTitle, tileUnavailable, usedTotal, type DrawerRow } from '../../domain/craftDrawer';
import type { MenuItem } from '../OrchDialogs';
import { IconPower, IconRefresh, IconTrash } from '../Icons';
import './drawer.css';

export function CraftDrawer({ running, openMenu }: { running: string[]; openMenu?: (e: React.MouseEvent, items: MenuItem[]) => void }) {
  const [rows, setRows] = useState<DrawerRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<Record<string, number>>({}); // 설치·여는 중(앱 → 누른 때)
  const [ask, setAsk] = useState<DrawerRow | null>(null);
  // 두 번에 — 먼저 네트워크 없이(깔린 앱·로컬 DMG·받아 둔 것, 1초 안) 그리고, 저장소에서 받아야 하는 칸만 자리표시였다가 전체로 채운다(v8 A2)
  const [full, setFull] = useState(false);
  const load = (refresh = false) => {
    setFull(false);
    if (!refresh) void invoke<DrawerRow[]>('craft_apps', { refresh: false, fast: true }).then((r) => setRows((old) => old ?? r), () => {});
    void invoke<DrawerRow[]>('craft_apps', { refresh }).then((r) => { setRows(r); setErr(''); setFull(true); }, (e) => { setErr(String(e)); setFull(true); });
  };
  useEffect(() => { load(); }, []);
  // 떠 오르면(독에 나타나면) 설치 중 표시를 걷고 목록을 다시(판·크기)
  useEffect(() => {
    const done = Object.keys(busy).filter((a) => running.includes(a) || Date.now() - busy[a]! > 180_000);
    if (!done.length) return;
    setBusy((b) => Object.fromEntries(Object.entries(b).filter(([a]) => !done.includes(a))));
    load();
  }, [running.join(), busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = (r: DrawerRow) => {
    const no = tileUnavailable(r);
    if (no) { setErr(no); return; } // 받을 수 없는 칸 — 설치를 걸지 않고 까닭 한 줄
    setBusy((b) => ({ ...b, [r.app]: Date.now() }));
    void invoke('craft_launch', { app: r.app }).catch((e) => setErr(String(e)));
  };
  const remove = (r: DrawerRow) => {
    setAsk(null);
    void invoke<string>('craft_remove', { app: r.app }).then(() => load(), (e) => setErr(String(e)));
  };
  const menu = (e: React.MouseEvent, r: DrawerRow) => {
    if (!openMenu) return;
    e.preventDefault();
    openMenu(e, [
      ...(tileUnavailable(r) ? [] : [{ label: r.installed ? tr('열기', 'Open') : tr('받아서 열기', 'Download and open'), run: () => launch(r) }]),
      ...(r.mine ? [{ label: tr('지우기 — 휴지통으로', 'Remove — to the Trash'), danger: true, sep: true, run: () => setAsk(r) }] : []),
    ]);
  };
  // 끄기(v7 A1) — 떠 있는 앱은 올리면 전원, 누르면 저장하고 끈다(독 오른쪽 클릭 '끄기'와 같은 길)
  const [stopping, setStopping] = useState<string[]>([]);
  const stop = (r: DrawerRow) => {
    setStopping((s) => [...s, r.app]);
    void invoke('craft_win_act', { app: r.app, act: 'close' }).catch(() => setStopping((s) => s.filter((a) => a !== r.app)));
  };
  useEffect(() => { setStopping((s) => s.filter((a) => running.includes(a))); }, [running.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const skTile = (key: string) => <div key={key} className="cd-tile cd-sktile" aria-hidden="true"><span className="cd-sk" /><span className="cd-skn" /></div>;
  const tile = (r: DrawerRow) => {
    if (tileLoading(r, !full)) return skTile(r.app);
    const working = r.app in busy;
    const on = running.includes(r.app);
    const corner = tileCorner(r, on);
    const quitting = stopping.includes(r.app);
    const no = tileUnavailable(r);
    return (
      <div key={r.app} className={`cd-tile${r.installed ? '' : ' off'}${working ? ' busy' : ''}${no ? ' no' : ''}`} title={tileTitle(r)} role="button" tabIndex={0}
        onClick={() => !working && launch(r)} onKeyDown={(e) => { if (e.key === 'Enter' && !working) launch(r); }} onContextMenu={(e) => menu(e, r)}>
        <span className="cd-icon">{tileIcon(r) ? <img src={tileIcon(r)} alt="" /> : <span className="cd-letter">{tileLetter(r)}</span>}{on && <i className="cd-run" aria-label={tr('켜져 있음', 'Running')} />}</span>
        <span className="cd-name">{r.name}</span>
        {quitting ? <span className="cd-sub">{tr('끄는 중', 'Quitting')}</span> : working ? <span className="cd-sub">{r.installed ? tr('여는 중', 'Opening') : tr('설치 중', 'Installing')}</span> : no ? <span className="cd-sub">{tr('받을 수 없음', 'Unavailable')}</span> : !r.installed && <span className="cd-sub">{tr('받기', 'Get')}</span>}
        {corner === 'quit' && !quitting && (
          <button className="cd-del cd-quit" aria-label={tr(`${r.name} 끄기 — 바뀐 게 있으면 저장하고`, `Quit ${r.name} — saves first if anything changed`)} title={tr(`${r.name} 끄기 — 바뀐 게 있으면 저장하고`, `Quit ${r.name} — saves first if anything changed`)}
            onClick={(e) => { e.stopPropagation(); stop(r); }}><IconPower /></button>
        )}
        {corner === 'remove' && !working && (
          <button className="cd-del" aria-label={tr(`${r.name} 지우기 — 휴지통으로`, `Remove ${r.name} — to the Trash`)} title={tr(`${r.name} 지우기 — 휴지통으로`, `Remove ${r.name} — to the Trash`)}
            onClick={(e) => { e.stopPropagation(); setAsk(r); }}><IconTrash /></button>
        )}
      </div>
    );
  };

  const split = rows ? splitRows(rows) : null;
  const refreshLabel = tr('새 판 확인', 'Check for new versions');
  return (
    <div className="cd">
      <div className="cd-head">
        <h1>{tr('Craft 앱', 'Craft apps')}</h1>
        {rows && <span className="cd-n">{rows.length}</span>}
        <span className="cd-sp" />
        {rows && <span className="cd-used">{tr(`이 맥에서 ${sizeText(usedTotal(rows)) || '0MB'}`, `${sizeText(usedTotal(rows)) || '0MB'} on this Mac`)}</span>}
        <button className="ib" aria-label={refreshLabel} title={refreshLabel} onClick={() => load(true)}><IconRefresh /></button>
      </div>
      {ask && (
        <div className="cd-ask">
          <span>{running.includes(ask.app)
            ? tr(`${ask.name} 지울까? 떠 있어서 저장하고 끈 뒤 앱·받은 것·설정·작업 폴더를 휴지통으로(되살릴 수 있어)`, `Remove ${ask.name}? It's open — it will be saved and closed, then the app, downloads, settings and work folder go to the Trash (recoverable)`)
            : tr(`${ask.name} 지울까? 앱·받은 것·설정·작업 폴더를 휴지통으로(되살릴 수 있어)`, `Remove ${ask.name}? The app, downloads, settings and work folder go to the Trash (recoverable)`)}</span>
          <span className="cd-sp" />
          <button className="cd-btn" onClick={() => setAsk(null)}>{tr('취소', 'Cancel')}</button>
          <button className="cd-btn danger" onClick={() => remove(ask)}>{tr('지우기', 'Remove')}</button>
        </div>
      )}
      {err && <div className="cd-err">{err}</div>}
      {!split && !err && <div className="cd-grid" aria-label={tr('앱 목록 받는 중', 'Loading apps')}>{Array.from({ length: 13 }, (_, k) => skTile(`sk${k}`))}</div>}
      {split && (
        <>
          {split.have.length > 0 && <><div className="cd-sec">{tr('깔린 것', 'Installed')}</div><div className="cd-grid">{split.have.map(tile)}</div></>}
          {split.can.length > 0 && <><div className="cd-sec">{tr('깔 수 있는 것', 'Available')}</div><div className="cd-grid">{split.can.map(tile)}</div></>}
        </>
      )}
    </div>
  );
}

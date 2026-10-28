// 앱 서랍(2026-10-17 사용자 '앱 서랍' — v3 덱 1, 런치패드처럼) — 스페이스 탭 줄 격자 아이콘을 누르면 이 칸.
// 13개 앱 아이콘 격자(아이콘 아래 이름 한 줄, 판·크기·마지막 사용은 올리면): 깔린 것은 누르면 열고, 안 깐 것은 흐리게 + '받기' — 누르면 깔기만(띄우지 않는다, 2026-10-28 사용자), 다 깔리면 '깔린 것'으로.
// 지우기는 우리가 깐 것만(마우스 올리면 휴지통 · 오른쪽 클릭), 한 번 묻고. 연 앱은 독 규칙대로 탭 줄에 붙는다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { josa, tr } from '../../i18n';
import { craftBase } from '../../domain/craftTab';
import type { DrawerOpen } from '../../domain/craftDock';
import { BROWSER_ICON, craftErr, drawerMemo, drawerView, mergeRows, NO_PYTHON, prefetchingAny, sizeText, splitRows, tileCorner, tileIcon, tileLetter, tileLoading, tileTitle, tileUnavailable, usedLine, usedTotal, type DrawerRow } from '../../domain/craftDrawer';
import { IS_WIN } from '../../domain/reader';
import type { MenuItem } from '../OrchDialogs';
import { IconPower, IconRefresh, IconTrash } from '../Icons';
import { openSetup } from '../space/navSignal';
import './drawer.css';

/** running = 이 참모의 떠 있는 인스턴스 키('photocraft'·'photocraft-2' …) — 서랍 칸은 앱 하나라 앱으로 묶는다.
 *  open = 누른 앱을 어떻게 열지(domain/craftDock drawerOpen — 내 것 보이기 또는 빈 자리 키로 새로). 없으면 앱째 */
/** 참모 브라우저 칸(2026-10-28) — Craft 앱은 아니지만 같은 서랍에. on = 떠 있음, open = 띄우고(이미 떠 있으면 그대로) 스페이스 칸으로 */
export type DrawerBrowser = { on: boolean; open: () => Promise<void> };

// 마지막 목록 — 서랍은 칸을 떠나면 지워져서 열 때마다 scripts/craft 를 새로 띄워(부하 25 에서 0.6~2초) 13칸이 자리표시였다(10-28 사용자).
// 기억으로 바로 그리고 뒤에서 조용히 새로 읽는다 — 앱을 다시 켜도 남게 저장소에도(막혀 있으면 메모리만)
const memo = drawerMemo((() => { try { return localStorage; } catch { return undefined; } })());

export function CraftDrawer({ running: keys, all = keys, open, openMenu, browser }: { running: string[]; all?: string[]; open?: (app: string) => DrawerOpen; openMenu?: (e: React.MouseEvent, items: MenuItem[]) => void; browser?: DrawerBrowser }) {
  const running = keys.map(craftBase);
  // 다른 참모 인스턴스가 떠 있나 — 지우기는 모든 인스턴스를 끄고 앱째 지워서 그땐 안 띄운다(내 것만 끄기는 그대로)
  const others = (app: string) => all.filter((k) => craftBase(k) === app).length > keys.filter((k) => craftBase(k) === app).length;
  const [rows, setRows] = useState<DrawerRow[] | null>(() => memo.load());
  const [err, setErr] = useState('');
  // 윈도우에 파이썬 3 이 없다(Rust no-python) — 오류 원문 대신 설치 안내 + 설치하기(설정 점검 줄의 winget 터미널), 눌렀으면 다시 시도도
  const [needPy, setNeedPy] = useState(false);
  const [pyTried, setPyTried] = useState(false);
  const fail = (e: unknown) => { const r = craftErr(e); setNeedPy(r.python); setErr(r.python ? '' : r.text); };
  const [busy, setBusy] = useState<Record<string, number>>({}); // 설치·여는 중(앱 → 누른 때)
  const [ask, setAsk] = useState<DrawerRow | null>(null);
  // 두 번에 — 먼저 네트워크 없이(깔린 앱·로컬 DMG·받아 둔 것, 1초 안) 그리고, 저장소에서 받아야 하는 칸만 자리표시였다가 전체로 채운다(v8 A2).
  // 기억이 있으면 그게 다 읽은 목록이라 먼저 읽기는 건너뛰고(스크립트를 두 번 안 띄움) 전체 읽기로 바뀐 칸만 바꾼다
  const [full, setFull] = useState(() => !!memo.load());
  const load = (refresh = false) => {
    setFull(!!memo.load());
    if (!refresh && !memo.load()) void invoke<DrawerRow[]>('craft_apps', { refresh: false, fast: true }).then((r) => setRows((old) => old ?? r), (e) => { if (!memo.load()) fail(e); });
    void invoke<DrawerRow[]>('craft_apps', { refresh }).then((r) => { memo.save(r); setRows((old) => mergeRows(old, r)); setErr(''); setNeedPy(false); setFull(true); }, (e) => { fail(e); setFull(true); });
  };
  useEffect(() => { load(); }, []);
  // 기본 앱을 뒤에서 받는 중이면(scripts/craft prefetch) 5초마다 네트워크 없이 다시 읽어 그 칸을 '설치 중' → 깔린 것으로
  const fetching = rows ? prefetchingAny(rows) : false;
  useEffect(() => {
    if (!fetching) return;
    const t = setInterval(() => { void invoke<DrawerRow[]>('craft_apps', { refresh: false, fast: true }).then((r) => setRows((old) => mergeRows(old, r)), () => {}); }, 5000);
    return () => clearInterval(t);
  }, [fetching]);
  // 떠 오르면(독에 나타나면) 설치 중 표시를 걷고 목록을 다시(판·크기)
  useEffect(() => {
    const done = Object.keys(busy).filter((a) => running.includes(a) || Date.now() - busy[a]! > 180_000);
    if (!done.length) return;
    setBusy((b) => Object.fromEntries(Object.entries(b).filter(([a]) => !done.includes(a))));
    load();
  }, [running.join(), busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // 받기 — 깔기만 하고 띄우지 않는다(scripts/craft install). 끝나면 목록을 다시 읽어 '깔린 것'으로, 여는 건 사람이 다시 누를 때
  const get = (r: DrawerRow) => {
    setBusy((b) => ({ ...b, [r.app]: Date.now() }));
    const done = () => setBusy((b) => Object.fromEntries(Object.entries(b).filter(([a]) => a !== r.app)));
    void invoke<string>('craft_install', { app: r.app }).then(() => { done(); load(); }, (e) => { done(); fail(e); });
  };
  const launch = (r: DrawerRow) => {
    const no = tileUnavailable(r);
    if (no) { setErr(no); return; } // 받을 수 없는 칸 — 설치를 걸지 않고 까닭 한 줄
    if (!r.installed) { get(r); return; }
    const how = open?.(r.app);
    if (how && 'show' in how) { void invoke('craft_show', { app: how.show }).catch((e) => setErr(String(e))); return; }
    if (how && 'full' in how) { setErr(tr(`${josa(r.name, '은', '는')} 다른 참모들이 셋 다 쓰는 중이에요 — 하나가 끝나면 다시 눌러 주세요`, `All three ${r.name} windows are in use by other assistants — try again when one finishes`)); return; }
    setBusy((b) => ({ ...b, [r.app]: Date.now() }));
    void invoke('craft_launch', { app: r.app, key: how?.key ?? null }).catch((e) => { setBusy((b) => Object.fromEntries(Object.entries(b).filter(([a]) => a !== r.app))); fail(e); });
  };
  const remove = (r: DrawerRow) => {
    setAsk(null);
    void invoke<string>('craft_remove', { app: r.app }).then(() => load(), (e) => setErr(String(e)));
  };
  const menu = (e: React.MouseEvent, r: DrawerRow) => {
    if (!openMenu) return;
    e.preventDefault();
    openMenu(e, [
      ...(tileUnavailable(r) ? [] : [{ label: r.installed ? tr('열기', 'Open') : tr('받기', 'Get'), run: () => launch(r) }]),
      ...(r.mine && !others(r.app) ? [{ label: tr('지우기 — 휴지통으로', 'Remove — to the Trash'), danger: true, sep: true, run: () => setAsk(r) }] : []),
    ]);
  };
  // 끄기(v7 A1) — 떠 있는 앱은 올리면 전원, 누르면 저장하고 끈다(독 오른쪽 클릭 '끄기'와 같은 길)
  const [stopping, setStopping] = useState<string[]>([]);
  // 서랍 칸은 앱째 — 세션마다 따로 떠 있으면 다 끈다(독 아이콘 '끄기'는 그 인스턴스만)
  const stop = (r: DrawerRow) => {
    setStopping((s) => [...s, r.app]);
    for (const k of keys.filter((x) => craftBase(x) === r.app)) void invoke('craft_win_act', { app: k, act: 'close' }).catch(() => setStopping((s) => s.filter((a) => a !== r.app)));
  };
  useEffect(() => { setStopping((s) => s.filter((a) => running.includes(a))); }, [running.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const skTile = (key: string) => <div key={key} className="cd-tile cd-sktile" aria-hidden="true"><span className="cd-sk" /><span className="cd-skn" /></div>;
  const tile = (r: DrawerRow) => {
    if (tileLoading(r, !full)) return skTile(r.app);
    const working = r.app in busy || !!r.prefetching;
    const on = running.includes(r.app);
    const corner = tileCorner(r, on, others(r.app));
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
  // 참모 브라우저 — 늘 '깔린 것' 맨 앞. 누르면 사람이 바로 쓰는 그 참모(HQ) 프로필 크롬이 스페이스 칸에(세션 없이도)
  const [bOpening, setBOpening] = useState(false);
  const bName = tr('참모 브라우저', 'Chammo browser');
  const openB = () => { if (!browser || bOpening) return; setBOpening(true); void browser.open().finally(() => setBOpening(false)); };
  const browserTile = browser && (
    <div key="@browser" className={`cd-tile${bOpening ? ' busy' : ''}`} title={tr('참모 브라우저 — 로그인이 남는 이 참모의 크롬', 'Chammo browser — this Chammo’s Chrome, logins kept')} role="button" tabIndex={0}
      onClick={openB} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openB(); } }}>
      <span className="cd-icon"><img src={BROWSER_ICON} alt="" />{browser.on && <i className="cd-run" aria-label={tr('켜져 있음', 'Running')} />}</span>
      <span className="cd-name">{bName}</span>
      {bOpening && <span className="cd-sub">{tr('여는 중', 'Opening')}</span>}
    </div>
  );
  const refreshLabel = tr('새 판 확인', 'Check for new versions');
  const retryLabel = tr('다시 시도', 'Try again');
  // 자리표시는 기억도 오류도 없을 때(처음 읽는 중)만 — 읽기가 실패하면 오류 한 줄 + 다시 시도
  const view = drawerView(rows, err);
  return (
    <div className="cd">
      <div className="cd-head">
        <h1>{tr('Craft 앱', 'Craft apps')}</h1>
        {rows && <span className="cd-n">{rows.length}</span>}
        <span className="cd-sp" />
        {rows && <span className="cd-used">{usedLine(usedTotal(rows), IS_WIN)}</span>}
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
      {needPy && (
        <div className="cd-ask">
          <span>{craftErr(NO_PYTHON).text}</span>
          <span className="cd-sp" />
          {pyTried && <button className="ib" aria-label={tr('다시 시도', 'Try again')} title={tr('다시 시도', 'Try again')} onClick={() => { setNeedPy(false); load(); }}><IconRefresh /></button>}
          <button className="cd-btn pri" onClick={() => { setPyTried(true); openSetup('python'); }}>{tr('설치하기', 'Install')}</button>
        </div>
      )}
      {err && <div className="cd-err"><span>{err}</span><button className="ib" aria-label={retryLabel} title={retryLabel} onClick={() => load()}><IconRefresh /></button></div>}
      {view === 'skeleton' && !needPy && <div className="cd-grid" aria-label={tr('앱 목록 받는 중', 'Loading apps')}>{Array.from({ length: 13 }, (_, k) => skTile(`sk${k}`))}</div>}
      {split && (
        <>
          {(split.have.length > 0 || browserTile) && <><div className="cd-sec">{tr('깔린 것', 'Installed')}</div><div className="cd-grid">{browserTile}{split.have.map(tile)}</div></>}
          {split.can.length > 0 && <><div className="cd-sec">{tr('깔 수 있는 것', 'Available')}</div><div className="cd-grid">{split.can.map(tile)}</div></>}
        </>
      )}
    </div>
  );
}

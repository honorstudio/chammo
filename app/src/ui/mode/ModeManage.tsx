// 모드 관리(10/12 사용자 "진짜 제거와 관리") — 고르기 시트 '관리'. 한 목록에 모드마다 출처·지금 자리·데이터 크기·실행 중, 단추는 출처대로
// 호스트는 깨어 있음(메모리)·잠듦 — keepAlive 를 안 적은 모드는 안 보인 지 5분이면 잔다.
// 기본 모드(맛보기·예시)·Claude 플러그인 = 숨기기(맨 아래 '숨긴 기본 모드'에서 다시 보이기), 내가 등록한 것·데이터 폴더 모드 = 제거.
// 원본 폴더는 '원본 폴더도 휴지통으로'를 고른 때만 맥 휴지통(영구 삭제 없음) — 그때만 한 번 묻는다. 되돌리기 토스트는 숨기기·원본 안 보낸 제거에만
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { tr } from '../../i18n';
import { hostState, manageGroups, removeUndo, sizeText, trashChoice, type ManageRow, type Removed } from '../../domain/modeManage';
import { IconChevronDown, IconChevronUp, IconClose } from '../Icons';
import { IconButton } from '../kit/IconButton';

const sourceText = (s: ManageRow['source']) =>
  s === 'example' ? tr('기본', 'Built-in') : s === 'added' ? tr('내가 등록', 'Added by me') : s === 'folder' ? tr('데이터 폴더', 'Data folder') : tr('Claude 플러그인', 'Claude plugin');

const placeText = (r: ManageRow) =>
  !r.on ? tr('꺼짐', 'Off')
    : r.where === 'dash' && r.dash ? tr(`${r.dash.split(' · ').pop()} 홈`, `${r.dash}'s home`)
      : r.where === 'panel' ? tr('스페이스 패널', 'Space panel') : r.where === 'modal' ? tr('미리보기', 'Preview') : r.where === 'full' ? tr('꽉 채우기', 'Full') : tr('따로 창', 'Window');

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Toast = { text: string; undo?: () => void };

export function ModeManage() {
  const [rows, setRows] = useState<ManageRow[] | null>(null);
  const [trash, setTrash] = useState<Record<string, boolean>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openHidden, setOpenHidden] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastT = useRef<number | undefined>(undefined);
  const load = () => void invoke<ManageRow[]>('mode_manage').then(setRows, (e) => setErr(errText(e)));
  useEffect(load, []);
  useEffect(() => () => window.clearTimeout(toastT.current), []);
  const say = (t: Toast) => { window.clearTimeout(toastT.current); setToast(t); toastT.current = window.setTimeout(() => setToast(null), 5000); };

  const run = (job: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    void job().catch((e) => setErr(errText(e))).finally(() => { setBusy(false); load(); });
  };
  const undo = (r: ManageRow) => run(async () => { setToast(null); await invoke('mode_restore', { name: r.name }); });
  const remove = (r: ManageRow, trashSource: boolean) => run(async () => {
    setAsking(null);
    const res = await invoke<Removed>('mode_remove', { name: r.name, trashSource });
    if (res.kind === 'hidden') say({ text: tr(`${r.title} 숨겼어`, `${r.title} hidden`), undo: () => undo(r) });
    else if (removeUndo(res)) say({ text: tr(`${r.title} 제거했어`, `${r.title} removed`), undo: () => undo(r) });
    else say({ text: tr(`${r.title} 제거 — 원본 폴더는 휴지통에`, `${r.title} removed — its folder is in the Trash`) });
  });
  const press = (r: ManageRow) => {
    const choice = trashChoice(r.source);
    const t = choice === 'required' || (choice === 'optional' && !!trash[r.name]);
    if (t) setAsking(r.name); else remove(r, false);
  };
  const show = (r: ManageRow) => run(async () => { await invoke('mode_restore_builtin', { name: r.name }); });

  if (!rows) return <div className="mdv-mg">{err ? <p className="mdv-try-err" role="alert">{err}</p> : <p className="mdv-mg-note">{tr('불러오는 중', 'Loading')}</p>}</div>;
  const g = manageGroups(rows);
  return (
    <div className="mdv-mg">
      <ul aria-label={tr('모드 목록', 'Modes')}>
        {g.list.map((r) => {
          const choice = trashChoice(r.source);
          const hs = hostState(r);
          const awake = !hs || hs.kind === 'asleep' ? null : hs.mem ? tr(`깨어 있음 ${hs.mem}`, `Awake ${hs.mem}`) : tr('깨어 있음', 'Awake');
          const host = !hs ? null : hs.kind === 'asleep' ? tr('잠듦', 'Asleep') : hs.shared ? `${awake} · ${tr('같이 쓰는 호스트', 'shared host')}` : awake;
          const meta = [sourceText(r.source), placeText(r), sizeText(r.size), host].filter(Boolean).join(' · ');
          return (
            <li key={r.name} className="mdv-mg-row">
              <div className="mdv-mg-main">
                <b>{r.title}</b>
                <small>{meta}</small>
                {choice !== 'none' && (
                  <label className="mdv-mg-trash" title={choice === 'required' ? tr('데이터 폴더 안 모드는 그 폴더가 원본이야', 'This mode lives in the data folder — its folder is the source') : r.dir}>
                    <input type="checkbox" checked={choice === 'required' || !!trash[r.name]} disabled={choice === 'required' || busy}
                      onChange={(e) => setTrash((m) => ({ ...m, [r.name]: e.target.checked }))} />
                    {tr('원본 폴더도 휴지통으로', 'Also move its folder to the Trash')}
                  </label>
                )}
                {asking === r.name && (
                  <div className="mdv-mg-ask" role="alert">
                    <span>{tr('원본 폴더를 맥 휴지통으로 보낼까? 휴지통에서 되살릴 수 있어.', 'Move its folder to the Trash? You can put it back from there.')}<small>{r.dir}</small></span>
                    <button type="button" className="btn danger" disabled={busy} onClick={() => remove(r, true)}>{tr('휴지통으로', 'Move to Trash')}</button>
                    <button type="button" className="btn" disabled={busy} onClick={() => setAsking(null)}>{tr('취소', 'Cancel')}</button>
                  </div>
                )}
              </div>
              <button type="button" className="btn" disabled={busy || asking === r.name} onClick={() => press(r)}>
                {r.way === 'hide' ? tr('숨기기', 'Hide') : tr('제거', 'Remove')}
              </button>
            </li>
          );
        })}
      </ul>
      {g.hidden.length > 0 && (
        <section className="mdv-mg-hidden">
          <button type="button" className="mdv-mg-more" aria-expanded={openHidden} onClick={() => setOpenHidden((v) => !v)}>
            {tr(`숨긴 기본 모드 ${g.hidden.length}개`, `Hidden built-in modes (${g.hidden.length})`)}{openHidden ? <IconChevronUp /> : <IconChevronDown />}
          </button>
          {openHidden && (
            <ul>
              {g.hidden.map((r) => (
                <li key={r.name} className="mdv-mg-row">
                  <div className="mdv-mg-main"><b>{r.title}</b><small>{sourceText(r.source)}</small></div>
                  <button type="button" className="btn" disabled={busy} onClick={() => show(r)}>{tr('다시 보이기', 'Show again')}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {err && <p className="mdv-try-err" role="alert"><span>{tr('못 바꿨어', "Couldn't change")} — {err}</span><IconButton size="s" label={tr('닫기', 'Dismiss')} onClick={() => setErr(null)}><IconClose /></IconButton></p>}
      {toast && (
        <div className="mdv-mg-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={toast.undo} disabled={busy}>{tr('되돌리기', 'Undo')}</button>}
        </div>
      )}
    </div>
  );
}

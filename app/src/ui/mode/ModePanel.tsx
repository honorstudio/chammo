// 메인 창 안 모드 자리 — 스페이스 패널(오른쪽 칸)·대시보드 칸·미리보기(모달)·꽉 채우기(스페이스 전체).
// 따로 창이 기본이고 이건 고른 사람만(docs/research/2026-10-05-chammo-mod.md '띄울 자리'). 머리줄은 넷이 같다: 이름 · 따로 창으로 · 끄기
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { tr } from '../../i18n';
import { IconClose, IconOpen } from '../Icons';
import { ModeView } from './ModeView';
import { MODE_EVENT, type ModeMsg } from './modeBus';
import { dashModes, panelModes, placedModes, type ModeRow } from '../../domain/modeTree';

/** 모드 목록 — 켜기·끄기·자리 옮김·띄움 끝에만 다시 읽는다(폴링 없음) */
export function useModeRows() {
  const [rows, setRows] = useState<ModeRow[]>([]);
  useEffect(() => {
    const load = () => void invoke<ModeRow[]>('mode_list').then(setRows, () => {});
    load();
    const on = (e: Event) => {
      const k = (e as CustomEvent<ModeMsg>).detail?.ev?.subtype;
      if (k === 'place' || k === 'closed' || k === 'ready') load();
    };
    window.addEventListener(MODE_EVENT, on);
    return () => window.removeEventListener(MODE_EVENT, on);
  }, []);
  return rows;
}

const toWindow = (name: string) => void invoke('mode_open', { name, place: 'window' }).catch(() => {});
const turnOff = (name: string) => void invoke('mode_close', { name }).catch(() => {});

/** 모드 한 칸 — 머리줄(이름 · 따로 창으로 · 끄기) + 그림 */
function ModeBox({ m, className, roomy }: { m: ModeRow; className: string; /** 넓은 자리(미리보기·꽉 채우기) — 머리줄과 같은 여백 */ roomy?: boolean }) {
  return (
    <section className={className} aria-label={m.title}>
      <header className="mdv-panel-head">
        <b>{m.title}</b>
        <span className="mdv-sp" />
        <button className="ib" onClick={() => toWindow(m.name)} aria-label={tr('따로 창으로', 'Open in a window')} title={tr('따로 창으로', 'Open in a window')}><IconOpen /></button>
        <button className="ib" onClick={() => turnOff(m.name)} aria-label={tr('끄기', 'Turn off')} title={tr('끄기', 'Turn off')}><IconClose /></button>
      </header>
      <ModeView name={m.name} compact={!roomy} />
    </section>
  );
}

export function ModePanel({ rows }: { rows: ModeRow[] }) {
  const shown = panelModes(rows);
  if (!shown.length) return null;
  return (
    <aside className="mdv-panel" aria-label={tr('모드', 'Modes')}>
      {shown.map((m) => <ModeBox key={m.name} m={m} className="mdv-panel-item" />)}
    </aside>
  );
}

/** 대시보드 칸 — keys = 이 대시보드를 가리키는 말(참모 이름·id, 프로젝트 이름·폴더) */
export function ModeDash({ rows, keys }: { rows: ModeRow[]; keys: string[] }) {
  const shown = dashModes(rows, keys);
  if (!shown.length) return null;
  return (
    <section className="mdv-dash" aria-label={tr('모드', 'Modes')}>
      {shown.map((m) => <ModeBox key={m.name} m={m} className="mdv-dash-item" />)}
    </section>
  );
}

/** 꽉 채우기(스페이스 전체, 맨 위 하나)·미리보기(스페이스 위 상자, 바깥·Esc = 끄기) — .space 안에 그린다 */
export function ModeLayer({ rows }: { rows: ModeRow[] }) {
  const full = placedModes(rows, 'full')[0];
  const modal = placedModes(rows, 'modal')[0];
  // Esc = 미리보기 끄기. 채팅 입력칸보다 먼저 잡아 삼킨다(입력칸 Esc 는 참모를 멈춘다) — 미리보기(Preview)와 같은 방식
  useEffect(() => {
    if (!modal) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      turnOff(modal.name);
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [modal]);
  return (
    <>
      {full && <ModeBox m={full} className="mdv-full" roomy />}
      {modal && (
        <div className="mdv-modal" onClick={() => turnOff(modal.name)}>
          <div className="mdv-modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={modal.title}>
            <ModeBox m={modal} className="mdv-modal-item" roomy />
          </div>
        </div>
      )}
    </>
  );
}

// 메인 창 안 모드 자리 — 스페이스 패널(오른쪽 칸)·대시보드 칸·미리보기(모달)·꽉 채우기(스페이스 전체).
// 따로 창이 기본이고 이건 고른 사람만(docs/research/2026-10-05-chammo-mod.md '띄울 자리'). 머리줄은 넷이 같다: 이름 · 따로 창으로 · 끄기
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState, type ReactNode } from 'react';


export { HOME_TRY } from './ModePick';
import { tr } from '../../i18n';
import { IconClose, IconDashboard, IconMaximize, IconOpen } from '../Icons';
import { modeLayout } from '../../domain/homeModes';
import { IconButton } from '../kit/IconButton';
import { ModeSheet, ModeTry, TryFail } from './ModePick';
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
      if (k === 'place' || k === 'closed' || k === 'ready' || k === 'list') load(); // list = 숨기기·제거·되살리기(관리)
    };
    window.addEventListener(MODE_EVENT, on);
    return () => window.removeEventListener(MODE_EVENT, on);
  }, []);
  return rows;
}

const toWindow = (name: string) => void invoke('mode_open', { name, place: 'window' }).catch(() => {});
const turnOff = (name: string) => void invoke('mode_close', { name }).catch(() => {});

/** 모드 한 칸 — 머리줄(이름 · 따로 창으로 · 끄기) + 그림 */
function ModeBox({ m, className, roomy, extra, offLabel }: { m: ModeRow; className: string; /** 넓은 자리(미리보기·꽉 채우기) — 머리줄과 같은 여백 */ roomy?: boolean; /** 머리줄 앞에 더 얹는 단추(홈의 '크게') */ extra?: ReactNode;
  /** 끄기 단추 이름 — 홈은 '이 홈에서 끄기'(모드 하나 = 자리 하나라 이 홈에서 끄면 다른 자리엔 원래 없다) */ offLabel?: string }) {
  const off = offLabel ?? tr('끄기', 'Turn off');
  return (
    <section className={className} aria-label={m.title}>
      <header className="mdv-panel-head">
        <b>{m.title}</b>
        <span className="mdv-sp" />
        {extra}
        <button className="ib" onClick={() => toWindow(m.name)} aria-label={tr('따로 창으로', 'Open in a window')} title={tr('따로 창으로', 'Open in a window')}><IconOpen /></button>
        <button className="ib" onClick={() => turnOff(m.name)} aria-label={off} title={off}><IconClose /></button>
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

const BIG_KEY = 'homeModeBig';
const loadBig = (k: string): string | null => { try { return (JSON.parse(localStorage.getItem(BIG_KEY) ?? '{}') as Record<string, string>)[k] ?? null; } catch { return null; } };

/** 홈 모드 칸(홈·모드 v1 정할 것 2·3) — 이 참모 대시보드 칸 자리(dash)에 둔 모드를 1 넓게 · 2 반반 · 3+ 하나 크게 + 옆 쌓기(셋, 넘치면 알약).
 *  '크게' = 큰 자리와 바꾸기(참모마다 기억). 머리 오른쪽 '모드' = 고르기 시트(10/12). 하나도 없으면 빈 칸에 같은 고르기 목록.
 *  keys = 이 참모를 가리키는 말, dash = 켤 자리(참모 이름), onAsk = 말로 새 모드 만들기(참모에게) */
export function ModeHome({ rows, keys, dash, onAsk }: { rows: ModeRow[]; keys: string[]; dash: string; onAsk: (text: string) => void }) {
  const shown = dashModes(rows, keys);
  const k = keys.find(Boolean) ?? ''; // 이름이 비어도 id 로 — 이름 없는 참모끼리 '크게' 기억이 섞이지 않게
  const [big, setBig] = useState<string | null>(() => loadBig(k));
  const [sheet, setSheet] = useState(false);
  useEffect(() => setBig(loadBig(k)), [k]);
  useEffect(() => setSheet(false), [k]);
  const choose = (name: string) => setBig(() => {
    try { const all = JSON.parse(localStorage.getItem(BIG_KEY) ?? '{}') as Record<string, string>; localStorage.setItem(BIG_KEY, JSON.stringify({ ...all, [k]: name })); } catch { /* 이번 실행만 */ }
    return name;
  });
  const lay = modeLayout(shown.map((m) => m.name), big);
  const of = (n: string) => shown.find((m) => m.name === n)!;
  const bigBtn = (n: string) => <button className="ib" onClick={() => choose(n)} aria-label={tr('크게', 'Make large')} title={tr('크게 — 큰 자리와 바꾸기', 'Make large')}><IconMaximize /></button>;
  const off = tr('이 홈에서 끄기', 'Turn off on this home');
  const box = (n: string, cls = 'mdv-home-item', o: { roomy?: boolean; extra?: ReactNode } = {}) => <ModeBox key={n} m={of(n)} className={cls} offLabel={off} {...o} />;
  if (lay.kind === 'none') return <ModeTry rows={rows} keys={keys} dash={dash} onAsk={onAsk} />;
  return (
    <>
      <div className="mdv-home-bar">
        <TryFail />
        <span className="mdv-sp" />
        <IconButton label={tr('모드 고르기', 'Pick modes')} pressed={sheet} onClick={() => setSheet(true)}><IconDashboard /></IconButton>
      </div>
      {lay.kind === 'one' && <div className="mdv-home one">{box(lay.big)}</div>}
      {lay.kind === 'two' && <div className="mdv-home two">{lay.items.map((n) => box(n))}</div>}
      {lay.kind === 'big' && (
        <div className="mdv-home big">
          {box(lay.big, 'mdv-home-item main', { roomy: true })}
          <div className="mdv-home-side">
            {lay.side.map((n) => box(n, 'mdv-home-item', { extra: bigBtn(n) }))}
            {lay.more.length > 0 && (
              <div className="mdv-home-more">{lay.more.map((n) => <button key={n} className="mdv-pill" onClick={() => choose(n)} title={tr('크게 — 큰 자리로', 'Make large')}>{of(n).title}</button>)}</div>
            )}
          </div>
        </div>
      )}
      {sheet && <ModeSheet rows={rows} keys={keys} dash={dash} onAsk={onAsk} onClose={() => setSheet(false)} />}
    </>
  );
}

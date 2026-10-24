// 줄 자리 확인 — 밀어서 재우기·제거, 꺼진 줄 깨우기를 누르면 그 줄이 이 확인 줄로 바뀐다(2026-10-23 사용자 폰: 목록 맨 위에 뜨던 확인 칸은
// 아래 줄을 밀었을 때 뜬지도 몰랐고 시트가 위로 튀었다). 다른 줄·스크롤은 그대로, 줄보다 커지면 이 줄만 화면 안으로(가까운 쪽)
import { useEffect, useRef } from 'react';

type Props = { label: string; q: string; note?: string; warn?: string; err?: string | null; ok: string; danger?: boolean; busy?: boolean; onOk: () => void; onCancel: () => void };

export function RowConfirm({ label, q, note, warn, err, ok, danger, busy, onOk, onCancel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, []);
  return (
    <div ref={box} className="m-row-confirm" role="alertdialog" aria-label={label}>
      <b>{q}</b>
      {note && <div className="m-muted m-sm">{note}</div>}
      {warn && <div className="m-sleep-warn">{warn}</div>}
      {err && <div className="m-error">{err}</div>}
      <div className="m-new-row">
        <button type="button" className="m-btn" onClick={onCancel}>취소</button>
        <button type="button" className={danger ? 'm-send m-danger' : 'm-send'} disabled={busy} onClick={onOk}>{ok}</button>
      </div>
    </div>
  );
}

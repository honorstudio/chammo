// 채팅 입력칸 위 머리줄의 모델·에포트 칩 — 지금 값을 보여 주고, 눌러서 바로 바꾼다(2026-10-01 사용자).
// 바꾸기 = 그 세션 터미널에서 /model 고르는 창을 열어 맞추고 "이 세션만"으로 확정(modelPickRun). 새 값은 상태줄 파일이 다음 갱신 때 알려 준다
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../../i18n';
import { effortChoices, familyOf, MODEL_CHOICES, modelChip } from '../../domain/modelPick';
import type { PickResult, PickWant } from './modelPickRun';

const POP_W = 300;

export type ModelInfo = { model?: string; modelId?: string; effort?: string };

export function ModelChip({ info, pick, locked, lockedWhy }: { info?: ModelInfo; pick: (want: PickWant) => Promise<PickResult>; locked?: boolean; lockedWhy?: string }) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false); // 바꾸는 중 — 값이 바뀌거나 6초가 지날 때까지
  const [fail, setFail] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ bottom: number; left: number } | null>(null);
  const label = modelChip(info);
  const family = familyOf(info?.modelId ?? info?.model);
  const key = `${info?.model ?? ''}|${info?.effort ?? ''}`;

  useEffect(() => { setAsked(false); }, [key]);
  useEffect(() => { if (!asked) return; const t = window.setTimeout(() => setAsked(false), 6000); return () => window.clearTimeout(t); }, [asked]);
  useEffect(() => { if (!fail) return; const t = window.setTimeout(() => setFail(null), 7000); return () => window.clearTimeout(t); }, [fail]);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!(e.target as HTMLElement).closest?.('.mc-pop, .mc-chip')) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc); };
  }, [open]);

  if (!label) return null;
  const toggle = () => {
    if (!open && btn.current) {
      const r = btn.current.getBoundingClientRect();
      // 칩 오른쪽 끝에 맞추되 창 밖으로 안 나가게(채팅 패널이 좁아도)
      setAt({ bottom: window.innerHeight - r.top + 6, left: Math.max(8, Math.min(r.right - POP_W, window.innerWidth - POP_W - 8)) });
    }
    setOpen((o) => !o);
  };
  const go = (want: PickWant) => {
    setOpen(false); setFail(null); setAsked(true);
    void pick(want).then((r) => { if (!r.ok) { setAsked(false); setFail(r.why); } else if (r.same) setAsked(false); });
  };
  const efforts = effortChoices(family);
  const curModel = family === 'other' ? '' : family;
  return (
    <>
      <button ref={btn} className={`mc-chip ${open ? 'on' : ''}`} onClick={toggle} disabled={locked || asked}
        title={locked ? lockedWhy : tr('모델·에포트 바꾸기', 'Change model / effort')}>
        {asked ? tr('바꾸는 중…', 'Changing…') : label}
      </button>
      {open && at && createPortal(
        <div className="mc-pop" style={{ bottom: at.bottom, left: at.left, width: POP_W }} role="menu">
          <div className="mc-row"><span className="mc-h">{tr('모델', 'Model')}</span>
            {MODEL_CHOICES.map((m) => (
              <button key={m.alias} role="menuitemradio" aria-checked={curModel === m.alias} className={curModel === m.alias ? 'sel' : ''} onClick={() => curModel !== m.alias && go({ model: m.alias })}>{m.label}</button>
            ))}
          </div>
          {efforts.length > 0 && (
            <div className="mc-row"><span className="mc-h">{tr('에포트', 'Effort')}</span>
              {efforts.map((e) => (
                <button key={e.level} role="menuitemradio" aria-checked={info?.effort === e.level} className={info?.effort === e.level ? 'sel' : ''} disabled={e.disabled} title={e.why}
                  onClick={() => info?.effort !== e.level && go({ effort: e.level })}>{e.level}</button>
              ))}
            </div>
          )}
          <div className="mc-note">{tr('이 세션에만 적용돼요 — 새 세션 기본값은 안 바뀌어요. 바꾸는 동안 터미널에서 /model 창이 잠깐 열려요', 'This session only — the default for new sessions stays. The /model picker opens briefly in the terminal')}</div>
        </div>,
        document.body,
      )}
      {fail && <span className="mc-fail" role="status">{fail}</span>}
    </>
  );
}

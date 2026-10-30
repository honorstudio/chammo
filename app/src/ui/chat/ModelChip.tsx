// 채팅 입력칸 위 머리줄의 모델·에포트 칩 — 지금 값을 보여 주고, 눌러서 바로 바꾼다(2026-10-01 사용자).
// 바꾸기 = 그 세션에 /model·/effort 를 치고 기본값은 되돌린다(modelPickRun). 새 값은 상태줄 파일이 다음 갱신 때 알려 준다
import { closeOnOutside } from '../outsideClose';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../../i18n';
import { effortChoices, isModel, MODEL_CHOICES, modelChip, OTHER_MODELS } from '../../domain/modelPick';
import { IconMore } from '../Icons';
import type { PickResult, PickWant } from './modelPickRun';

const POP_W = 344;

export type ModelInfo = { model?: string; modelId?: string; effort?: string };

export function ModelChip({ info, pick, locked, lockedWhy, openSignal = 0 }: { info?: ModelInfo; pick: (want: PickWant) => Promise<PickResult>; locked?: boolean; lockedWhy?: string; /** 늘어나면 메뉴를 연다(채팅에 /model 만 쳤을 때) */ openSignal?: number }) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false); // '그 밖' 모델 줄 펼침
  const [asked, setAsked] = useState(false); // 바꾸는 중 — 값이 바뀌거나 6초가 지날 때까지
  const [fail, setFail] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ bottom: number; left: number } | null>(null);
  const label = modelChip(info);
  const key = `${info?.model ?? ''}|${info?.effort ?? ''}`;

  useEffect(() => { setAsked(false); }, [key]);
  useEffect(() => { if (!asked) return; const t = window.setTimeout(() => setAsked(false), 6000); return () => window.clearTimeout(t); }, [asked]);
  useEffect(() => { if (!fail) return; const t = window.setTimeout(() => setFail(null), 7000); return () => window.clearTimeout(t); }, [fail]);
  useEffect(() => {
    if (!open) return;
    const stopOutside = closeOnOutside(window, (t) => !!(t as HTMLElement).closest?.('.mc-pop, .mc-chip'), () => setOpen(false));
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => { stopOutside(); window.removeEventListener('keydown', esc); };
  }, [open]);

  useEffect(() => { if (openSignal > 0 && !locked && !open) toggle(); }, [openSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!label) return null;
  function toggle() {
    if (!open && btn.current) {
      const r = btn.current.getBoundingClientRect();
      // 칩 오른쪽 끝에 맞추되 창 밖으로 안 나가게(채팅 패널이 좁아도)
      setAt({ bottom: window.innerHeight - r.top + 6, left: Math.max(8, Math.min(r.right - POP_W, window.innerWidth - POP_W - 8)) });
    }
    setMore(false);
    setOpen((o) => !o);
  }
  const go = (want: PickWant) => {
    setOpen(false); setFail(null); setAsked(true);
    void pick(want).then((r) => { if (!r.ok) { setAsked(false); setFail(r.why); } else if (r.same) setAsked(false); });
  };
  const efforts = effortChoices(info);
  // 지금 모델이 '그 밖'(옛 판·Fable)이면 펼친 채로 — 칸이 안 보이면 4.8 로 떨어진 걸 모른다(2026-10-29 사용자)
  const showOther = more || OTHER_MODELS.some((m) => isModel(info, m.id));
  const modelBtn = (m: { id: string; label: string }) => {
    const sel = isModel(info, m.id);
    return <button key={m.id} role="menuitemradio" aria-checked={sel} className={sel ? 'sel' : ''} onClick={() => !sel && go({ model: m.id })}>{m.label}</button>;
  };
  return (
    <>
      <button ref={btn} className={`mc-chip ${open ? 'on' : ''}`} onClick={toggle} disabled={locked || asked}
        title={locked ? lockedWhy : tr('모델·에포트 바꾸기', 'Change model / effort')}>
        {asked ? tr('바꾸는 중…', 'Changing…') : label}
      </button>
      {open && at && createPortal(
        <div className="mc-pop" style={{ bottom: at.bottom, left: at.left, width: POP_W }} role="menu">
          <div className="mc-row"><span className="mc-h">{tr('모델', 'Model')}</span>
            {MODEL_CHOICES.map(modelBtn)}
            <button className={`mc-more${showOther ? ' on' : ''}`} aria-expanded={showOther} aria-label={tr('다른 모델', 'Other models')} title={tr('다른 모델', 'Other models')} onClick={() => setMore((v) => !v)}><IconMore /></button>
          </div>
          {showOther && <div className="mc-row mc-other">{OTHER_MODELS.map(modelBtn)}</div>}
          {efforts.length > 0 && (
            <div className="mc-row"><span className="mc-h">{tr('에포트', 'Effort')}</span>
              {efforts.map((e) => (
                <button key={e.level} role="menuitemradio" aria-checked={info?.effort === e.level} className={info?.effort === e.level ? 'sel' : ''} disabled={e.disabled} title={e.why}
                  onClick={() => info?.effort !== e.level && go({ effort: e.level })}>{e.level}</button>
              ))}
            </div>
          )}
          <div className="mc-note">{tr('이 세션에만 적용돼요 — 새 세션 기본값은 안 바뀌어요. 일하는 중이어도 바로 바뀌어요', 'This session only — the default for new sessions stays. Works even while it is busy')}</div>
        </div>,
        document.body,
      )}
      {fail && <span className="mc-fail" role="status">{fail}</span>}
    </>
  );
}

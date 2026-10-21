import { useEffect, useState } from 'react';
import { tourSteps } from '../domain/tour';
import { tr } from '../i18n';
import { IconClose, IconNext, IconPrev } from './Icons';
import { IconButton } from './kit/IconButton';
import './tour.css';

/** 둘러보기 — 카드 한 장씩, 이전·다음·건너뛰기. Esc 로 닫힌다. 익숙한 동작(닫기·이전·다음)은 아이콘, 끝의 시작하기만 글자 */
export function Tour({ none, onClose }: { none: boolean; onClose: () => void }) {
  const steps = tourSteps({ none });
  const [i, setI] = useState(0);
  const last = i === steps.length - 1;
  const s = steps[i]!;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && !last) setI((n) => n + 1);
      else if (e.key === 'ArrowLeft' && i > 0) setI((n) => n - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [i, last, onClose]);
  return (
    <div className="tour" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tour-card" role="dialog" aria-modal="true" aria-label={tr('둘러보기', 'Tour')}>
        <div className="tour-top">
          <span className="tour-count">{i + 1} / {steps.length}</span>
          <IconButton className="tour-skip" label={last ? tr('닫기', 'Close') : tr('건너뛰기', 'Skip')} title={tr('닫기 (Esc)', 'Close (Esc)')} onClick={onClose}><IconClose /></IconButton>
        </div>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        {s.keys && (
          <dl className="tour-keys">
            {s.keys.map(([k, v]) => (
              <div key={k}><dt>{k.split(' · ').map((p, n) => <span key={n} className="tour-k">{n > 0 ? `· ${p}` : p}</span>)}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        <div className="tour-nav">
          <ol className="tour-dots" aria-hidden>
            {steps.map((_, n) => <li key={n} className={n === i ? 'on' : ''} />)}
          </ol>
          <span className="grow" />
          {i > 0 && <IconButton size="l" tone="line" label={tr('이전', 'Back')} onClick={() => setI(i - 1)}><IconPrev /></IconButton>}
          {last
            ? <button className="btn pri" onClick={onClose}>{tr('시작하기', 'Get started')}</button>
            : <IconButton size="l" tone="pri" label={tr('다음', 'Next')} onClick={() => setI(i + 1)}><IconNext /></IconButton>}
        </div>
      </div>
    </div>
  );
}

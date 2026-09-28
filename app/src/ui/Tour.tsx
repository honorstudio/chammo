import { useEffect, useState } from 'react';
import { tourSteps } from '../domain/tour';
import { tr } from '../i18n';
import './tour.css';

/** 둘러보기 — 카드 한 장씩, 이전·다음·건너뛰기. Esc 로 닫힌다. 아이콘 없이 글자만(CLAUDE.md) */
export function Tour({ onClose }: { onClose: () => void }) {
  const steps = tourSteps();
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
          <button className="tour-skip" onClick={onClose}>{last ? tr('닫기', 'Close') : tr('건너뛰기', 'Skip')}</button>
        </div>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        {s.keys && (
          <dl className="tour-keys">
            {s.keys.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        <div className="tour-nav">
          <ol className="tour-dots" aria-hidden>
            {steps.map((_, n) => <li key={n} className={n === i ? 'on' : ''} />)}
          </ol>
          <span className="grow" />
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>{tr('이전', 'Back')}</button>}
          <button className="btn pri" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? tr('시작하기', 'Get started') : tr('다음', 'Next')}</button>
        </div>
      </div>
    </div>
  );
}

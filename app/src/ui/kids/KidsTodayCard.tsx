// 보호자 '오늘 만든 것' 카드(계획서 H) — 키즈 참모 보호자 채팅 입력칸 위에 한 줄. 누르면 작품마다 고친 과정, 작품 이름을 누르면 그 작품을 크게.
// 작은 그림을 늘 띄우지 않는다 — 작품은 애니메이션·게임이라 칸마다 돌면 맥이 무거워진다. 열 때만 패드와 같은 막힘(sandbox 스크립트만 + 맥이 붙인 CSP)
import { useEffect, useState } from 'react';
import { kidsTodayLine, type KidsToday } from '../../domain/kidsToday';
import { tr } from '../../i18n';
import { IconClose } from '../Icons';

export function KidsTodayCard({ today, child, open: openWork }: { today: KidsToday; child: string; open: (name: string) => Promise<string> }) {
  const [wide, setWide] = useState(false);
  const [shown, setShown] = useState<{ title: string; html: string } | null>(null);
  useEffect(() => {
    if (!shown) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setShown(null); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [shown]);
  const line = kidsTodayLine(today, child);
  return (
    <div className="kt">
      <button type="button" className="kt-line" aria-expanded={wide} onClick={() => setWide((w) => !w)} title={line}>{line}</button>
      {wide && today.works.length > 0 && (
        <ul className="kt-works">
          {today.works.map((w) => (
            <li key={w.name}>
              <button type="button" className="kt-title" onClick={() => void openWork(w.name).then((html) => setShown({ title: w.title, html }), () => {})}>{w.title}</button>
              {w.steps.length > 0 && <span className="kt-steps">{w.steps.join(' → ')}</span>}
            </li>
          ))}
        </ul>
      )}
      {shown && (
        <div className="kt-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setShown(null); }}>
          <div className="kt-frame" role="dialog" aria-label={shown.title}>
            <button type="button" className="kt-close" aria-label={tr('닫기', 'Close')} title={tr('닫기', 'Close')} onClick={() => setShown(null)}><IconClose /></button>
            <iframe sandbox="allow-scripts" srcDoc={shown.html} title={shown.title} />
          </div>
        </div>
      )}
    </div>
  );
}

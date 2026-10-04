// 목소리 다이얼 — 하나씩 넘기면 넘긴 목소리로 바로 인사말을 들려준다(2026-10-02 목소리 고르기 시안 B 확정).
// 들어 보기는 준비 중(Supertonic 이 1~2초 만든다) → 재생 중 → 끝. 빨리 넘기면 마지막 것만 소리 낸다
import { useEffect, useRef, useState } from 'react';
import { speakPreview, speakPreviewState, speakPreviewStop } from '../../data/tauri';
import { helloLine, VOICES, type Voice } from '../../domain/avatar';
import { debounce, dialLabel, dialStart, isLive, stepDial, viewPhase, type ViewPhase } from '../../domain/voiceDial';
import { tr } from '../../i18n';
import { IconNext, IconPlay, IconPrev, IconReplay } from '../Icons';

let lastId = 0; // 번호는 시각에서 따서 늘 커진다 — 화면 코드를 다시 불러와 0 부터 세면 앞서 멈춘 번호와 겹쳐 바로 '멈춤'이 됐다

export function VoiceDial({ voice, onVoice, def, label, color, canListen }: {
  voice: Voice | null; onVoice: (v: Voice | null) => void; def: Voice | undefined; label: string; color: string; canListen: boolean;
}) {
  const [idx, setIdx] = useState(() => dialStart(voice, def));
  const [mine, setMine] = useState(0);
  const [phase, setPhase] = useState<ViewPhase>('idle');
  const [tick, setTick] = useState(0); // 같은 상태가 와도 다시 묻게 — 상태만 deps 로 두면 '준비 중'이 이어질 때 한 번 묻고 멈췄다
  const cur = VOICES[idx]!;
  const down = useRef<number | null>(null);

  const play = (v: Voice) => {
    if (!canListen) return;
    const id = (lastId = Math.max(lastId + 1, Date.now()));
    setMine(id);
    setPhase('preparing');
    void speakPreview(id, helloLine(label), v);
  };
  const playRef = useRef(play);
  playRef.current = play;
  const later = useRef(debounce((v: Voice) => playRef.current(v), 300)); // 빨리 넘기면 마지막 것만
  useEffect(() => () => later.current.cancel(), []);

  // 재생하는 몇 초만 짧게 묻는다
  useEffect(() => {
    if (!mine || !isLive(phase)) return;
    const t = window.setTimeout(() => {
      void speakPreviewState().then((s) => { setPhase(viewPhase(mine, s)); setTick((n) => n + 1); }).catch(() => setPhase('done'));
    }, 150);
    return () => window.clearTimeout(t);
  }, [mine, phase, tick]);
  // 창을 닫으면 들어 보기도 멈춘다
  const live = useRef({ mine, phase });
  live.current = { mine, phase };
  useEffect(() => () => { if (isLive(live.current.phase)) void speakPreviewStop(live.current.mine); }, []);

  const go = (d: 1 | -1) => {
    const i = stepDial(idx, d);
    setIdx(i);
    onVoice(VOICES[i]!);
    later.current(VOICES[i]!);
  };
  const toDefault = () => {
    const i = dialStart(null, def);
    setIdx(i);
    onVoice(null);
    later.current.cancel();
    play(VOICES[i]!);
  };
  const center = () => {
    if (isLive(phase)) { void speakPreviewStop(mine); setPhase('stopped'); }
    else play(cur);
  };

  const shown = voice === null ? dialLabel(null, def) : cur;
  const near = (d: 1 | -1) => VOICES[stepDial(idx, d)]!;
  return (
    <div className="oa-dial" style={{ ['--oa-dial-c' as string]: color }}>
      <div className="oa-dial-row" tabIndex={0} role="group" aria-label={tr(`목소리 ${shown} — 좌우 화살표로 넘기기`, `Voice ${shown} — use arrow keys`)}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } }}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') down.current = e.clientX; }}
        onPointerUp={(e) => { const x = down.current; down.current = null; if (x !== null && Math.abs(e.clientX - x) > 40) go(e.clientX < x ? 1 : -1); }}>
        <button className="oa-dial-arrow" onClick={() => go(-1)} aria-label={tr('이전 목소리', 'Previous voice')} title={tr('이전 목소리', 'Previous voice')}><IconPrev /></button>
        <button className="oa-dial-face" onClick={center} disabled={!canListen}
          aria-label={isLive(phase) ? tr('멈춤', 'Stop') : tr(`${shown} 다시 듣기`, `Play ${shown} again`)} title={isLive(phase) ? tr('멈춤', 'Stop') : tr('다시 듣기', 'Play again')}>
          <span className="oa-dial-names"><span>{near(-1)}</span><b>{shown}</b><span>{near(1)}</span></span>
          <span className={`oa-dial-st st-${phase}`} aria-live="polite">
            {phase === 'preparing' ? <span className="oa-dial-dots" aria-label={tr('준비 중', 'Preparing')}><i /><i /><i /></span>
              : phase === 'playing' ? <span className="oa-dial-wave" aria-label={tr('재생 중', 'Playing')}>{Array.from({ length: 12 }, (_, k) => <i key={k} />)}</span>
              : canListen ? <span className="oa-dial-play"><IconPlay /></span> : null}
          </span>
        </button>
        <button className="oa-dial-arrow" onClick={() => go(1)} aria-label={tr('다음 목소리', 'Next voice')} title={tr('다음 목소리', 'Next voice')}><IconNext /></button>
      </div>
      <div className="oa-dial-foot">
        <span className="oa-dial-dotsrow" aria-hidden="true">{VOICES.map((v, i) => <i key={v} className={i === idx ? 'on' : ''} />)}</span>
        <button className="oa-dial-def" onClick={toDefault} disabled={voice === null} aria-label={tr('기본으로', 'Use default')} title={tr(`기본으로${def ? ` (지금 배정 ${def})` : ''}`, `Use default${def ? ` (now ${def})` : ''}`)}><IconReplay /></button>
      </div>
    </div>
  );
}

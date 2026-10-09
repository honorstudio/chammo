// 맥 부하 시트 — 대시보드 머리줄 부하 칩을 누르면 아래에서 올라온다(사용자 2026-10-05 "PC 안 보면 왜 느린지 모르겠다").
// 지금 부하·스왑, 왜 느린지 한 줄, 세션별 상위, 빌드·시뮬레이터·갤럭시 자리 누가 몇 분째. 보기만 — 끄기는 데스크톱 부하 화면
import { useEffect, useState } from 'react';
import { readLoad } from '../../data/web';
import { fmtDur } from '../../domain/load';
import { readPhoneLoad, slotLine } from '../../domain/phoneLoad';
import { IconClose } from '../Icons';
import { machine } from '../../i18n';

const SLOT_NAME: Record<string, string> = { build: '빌드', ios: 'iOS 시뮬레이터', galaxy: '갤럭시' };

type Props = { text: string; onChanged: (text: string) => void; onClose: () => void };

export function LoadSheet({ text, onChanged, onClose }: Props) {
  const v = readPhoneLoad(text);
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  // 열어 둔 동안은 5초마다 — 대시보드는 15초마다라 보고 있을 땐 더 자주
  useEffect(() => {
    const get = () => { readLoad().then(onChanged, () => {}); };
    get();
    const t = setInterval(get, 5000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setShown(false); window.setTimeout(onClose, 220); };

  return (
    <div className="m-pick-wrap" role="dialog" aria-modal="true" aria-label={`${machine()} 부하`}>
      <button type="button" className={shown ? 'm-pick-back m-on' : 'm-pick-back'} aria-label="닫기" onClick={close} />
      <div className="m-pick" style={{ transform: shown ? 'translateY(0)' : 'translateY(100%)' }}>
        <div className="m-pick-grab"><div className="m-handle" /></div>
        <div className="m-picker-head">
          <b>{machine()} 부하</b>
          <button type="button" className="m-icon" onClick={close} aria-label="닫기" title="닫기"><IconClose /></button>
        </div>
        <div className="m-picker-list">
          {!v && <p className="m-muted m-sm">{text ? '부하를 못 읽었어요' : '불러오는 중…'}</p>}
          {v && v.level !== 'unknown' && (
            <div className={`m-load-now ld-${v.stale ? 'unknown' : v.level}`}>
              <div className="m-load-big">
                <span className="m-load-dot" aria-hidden="true" />
                <b>{v.label}</b>
                <span className="m-load-num">{v.load1 >= 10 ? Math.round(v.load1) : v.load1.toFixed(1)}<small> / {v.cores}</small></span>
                {v.swapGb > 0 && <span className="m-load-num">스왑 {v.swapGb}G</span>}
              </div>
              <div className="m-load-why">{v.why}</div>
              {v.stale && v.ageSec !== null && <div className="m-muted m-sm">{fmtDur(v.ageSec)} 전 값 — {machine()} 앱이 안 재고 있어요</div>}
            </div>
          )}
          {v && v.level === 'unknown' && <p className="m-muted m-sm">{v.why}</p>}
          {v && v.sessions.length > 0 && (
            <section className="m-load-list" aria-label="세션별">
              <div className="m-sect">세션</div>
              {v.sessions.map((s) => (
                <div key={`${s.name}/${s.project}`} className="m-load-row">
                  <span className="m-load-name"><b>{s.name}</b><span>{s.what ? `${s.project} · ${s.what}` : s.project}</span></span>
                  <span className={s.cpu >= 100 ? 'm-load-cpu m-hot' : 'm-load-cpu'}>{s.cpu}%</span>
                  <span className="m-load-mem">{s.mem}</span>
                </div>
              ))}
            </section>
          )}
          {v && (
            <section className="m-load-list" aria-label="자리">
              <div className="m-sect">자리</div>
              {v.slots.map((s) => (
                <div key={s.name} className="m-load-row">
                  <span className="m-load-name"><b>{SLOT_NAME[s.name] ?? s.name}</b></span>
                  <span className={s.owner ? 'm-load-who' : 'm-load-who m-muted'}>{slotLine(s)}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

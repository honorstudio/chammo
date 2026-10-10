import { useEffect, useState } from 'react';
import { loadKill } from '../data/tauri';
import { fmtDur, fmtMem, level, parseEtime, procLabel, type LoadReport, type Proc, type SysLoad } from '../domain/load';
import { tr } from '../i18n';

type Props = {
  sys: SysLoad | null;
  report: LoadReport | null;
  /** 세션 줄을 누르면 그 세션 화면으로 */
  onOpen: (sessionId: string) => void;
  onKilled: () => void;
};

const pct = (n: number) => `${Math.round(n)}%`;

/** 무엇이 먹나 — 대표 프로세스 몇 개를 "이름 CPU · 메모리"로 */
function Top({ list }: { list: Proc[] }) {
  const shown = list.filter((p) => p.cpu >= 0.5 || p.rssKb >= 50 * 1024).slice(0, 4);
  if (!shown.length) return <span className="ld-dim">{tr('조용함', 'Quiet')}</span>;
  return (
    <span className="ld-top">
      {shown.map((p) => (
        <span key={p.pid} title={p.cmd}>{procLabel(p.cmd)} <b>{pct(p.cpu)}</b> · {fmtMem(p.rssKb)}</span>
      ))}
    </span>
  );
}

/**
 * 부하 화면 — 이 맥의 CPU·메모리를 누가 먹는지 세션별로(사용자 2026-09-28). CPU 100% = 코어 하나.
 * 세션은 끝났는데 남은 프로세스(dev 서버·시뮬레이터 등)는 여기서 끈다 — Claude 가 띄운 것만 꺼진다
 */
export function LoadPage({ sys, report, onOpen, onKilled }: Props) {
  const [sure, setSure] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { if (sure === null) return; const t = setTimeout(() => setSure(null), 4000); return () => clearTimeout(t); }, [sure]);
  if (!sys || !report) return <div className="empty">{tr('재는 중…', 'Measuring…')}</div>;
  const lv = level(sys);
  const kill = async (pid: number) => {
    if (sure !== pid) { setSure(pid); return; }
    setSure(null);
    try {
      const n = await loadKill(pid);
      setNote(tr(`프로세스 ${n}개를 껐어요`, `Stopped ${n} process${n === 1 ? '' : 'es'}`));
      onKilled();
    } catch (e) { setNote(String(e)); }
  };
  const mineCpu = report.sessions.reduce((n, s) => n + s.cpu, 0) + report.orphans.reduce((n, o) => n + o.cpu, 0);
  return (
    <div className="load">
      <div className="ld-head">
        <b className={`ld-lv ${lv}`}>{lv === 'high' ? tr('부하 높음', 'Heavy load') : lv === 'warn' ? tr('부하 주의', 'Busy') : tr('여유 있음', 'Fine')}</b>
        <span>{tr(`코어 ${sys.cores}개 · 1분 부하 ${sys.load1.toFixed(1)} (5분 ${sys.load5.toFixed(1)})`, `${sys.cores} cores · load ${sys.load1.toFixed(1)} (5 min ${sys.load5.toFixed(1)})`)}</span>
        <span>{tr(`스왑 ${(sys.swapUsedMb / 1024).toFixed(1)}/${(sys.swapTotalMb / 1024).toFixed(1)}GB`, `Swap ${(sys.swapUsedMb / 1024).toFixed(1)}/${(sys.swapTotalMb / 1024).toFixed(1)}GB`)}</span>
        <span className="ld-dim">{tr(`Chammo 몫 CPU ${pct(mineCpu)} · 100% = 코어 하나`, `Chammo's share ${pct(mineCpu)} CPU · 100% = one core`)}</span>
      </div>
      {note && <div className="ld-note">{note}</div>}
      <div className="ld-body">
        <section className="ld-sec">
          <h3>{tr('세션별', 'By session')}</h3>
          <div className="ld-rows">
            <div className="ld-row ld-th"><span>{tr('세션', 'Session')}</span><span>CPU</span><span>{tr('메모리', 'Memory')}</span><span>{tr('무엇이 먹나', 'What is using it')}</span></div>
            {report.sessions.map((s) => (
              <button type="button" key={s.id} className="ld-row" onClick={() => onOpen(s.id)} title={tr('그 세션으로 가기', 'Go to that session')}>
                <span className="ld-name">{s.name}{s.project && s.project !== s.name && <span className="ld-dim"> · {s.project}</span>}</span>
                <span className="ld-num">{pct(s.cpu)}</span>
                <span className="ld-num">{fmtMem(s.rssKb)}</span>
                <Top list={s.top} />
              </button>
            ))}
          </div>
        </section>
        <section className="ld-sec">
          <h3>{tr(`주인 없는 프로세스 · ${report.orphans.length}`, `Left behind · ${report.orphans.length}`)}</h3>
          <p className="ld-dim">{tr('세션은 끝났는데 남아 있는 것 — 개발 서버·시뮬레이터·브라우저 등. Claude 가 띄운 것만 끌 수 있어요.', 'Still running after their session ended — dev servers, simulators, browsers. Only things Claude started can be stopped.')}</p>
          {report.orphans.length === 0 ? <div className="ld-dim ld-pad">{tr('없어요', 'None')}</div> : (
            <div className="ld-rows">
              {report.orphans.map((o) => (
                <div key={o.pid} className="ld-row ld-orphan" title={o.cmd}>
                  <span className="ld-name">{procLabel(o.cmd)}<span className="ld-dim"> · pid {o.pid}{o.count > 1 ? tr(` 외 ${o.count - 1}개`, ` +${o.count - 1}`) : ''}</span></span>
                  <span className="ld-num">{pct(o.cpu)}</span>
                  <span className="ld-num">{fmtMem(o.rssKb)}</span>
                  <span className="ld-act">
                    <span className="ld-dim">{tr(`${fmtDur(parseEtime(o.etime))}째`, `up ${fmtDur(parseEtime(o.etime))}`)}</span>
                    <button type="button" className={`btn su-mini ${sure === o.pid ? 'danger' : ''}`} onClick={() => void kill(o.pid)}>{sure === o.pid ? tr('정말 끄기', 'Really stop') : tr('끄기', 'Stop')}</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        {report.modes.length > 0 && (
          <section className="ld-sec">
            <h3>{tr(`켜진 모드 · ${report.modes.length}`, `Modes on · ${report.modes.length}`)}</h3>
            <p className="ld-dim">{tr('모드 하나당 Claude 프로세스 하나 — 안 쓰는 모드는 메뉴바 모드에서 끄면 메모리가 돌아와요.', 'Each mode runs one Claude process — turn off modes you are not using (Modes menu) to free the memory.')}</p>
            <div className="ld-rows">
              {report.modes.map((m) => (
                <div key={m.name} className="ld-row ld-static"><span className="ld-name">{m.name}</span><span className="ld-num">{pct(m.cpu)}</span><span className="ld-num">{fmtMem(m.rssKb)}</span><span /></div>
              ))}
            </div>
          </section>
        )}
        <section className="ld-sec">
          <h3>{tr('그 밖', 'Everything else')}</h3>
          <div className="ld-rows">
            <div className="ld-row ld-static"><span className="ld-name">{tr('Chammo 밖 Claude', 'Claude outside Chammo')}</span><span className="ld-num">{pct(report.outside.cpu)}</span><span className="ld-num">{fmtMem(report.outside.rssKb)}</span><Top list={report.outside.top} /></div>
            <div className="ld-row ld-static"><span className="ld-name">{tr('다른 앱·시스템', 'Other apps & system')}</span><span className="ld-num">{pct(report.rest.cpu)}</span><span className="ld-num">{fmtMem(report.rest.rssKb)}</span><Top list={report.rest.top} /></div>
          </div>
        </section>
      </div>
    </div>
  );
}

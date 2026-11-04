import { useEffect, useRef, useState } from 'react';
import { fmtMem, type LoadReport, type Lv, type SysLoad } from '../domain/load';
import { loadCard, type CardItem } from '../domain/loadCard';
import { assistant, tr } from '../i18n';
import { seenName } from '../domain/session';
import { IconCpu, IconDisk, IconGauge, IconMemory, IconOpen, IconTrash } from './Icons';

type Props = {
  sys: SysLoad;
  report: LoadReport | null;
  /** 자세히 보기(떠 있는 창)가 열려 있나 */
  detailOn: boolean;
  onDetail: (anchor: DOMRect) => void;
  /** 카드가 열리고 닫힐 때 — 열려 있는 동안만 자주 잰다(useLoad fast) */
  onHover: (open: boolean) => void;
  /** 저장공간 정리 부탁 — 참모 채팅에 사람 말 한 줄 */
  onClean: (text: string) => Promise<void>;
  onOpenSession: (id: string) => void;
};

const WORD: Record<CardItem['key'], Record<Lv, () => string>> = {
  cpu: { ok: () => tr('한가', 'Idle'), warn: () => tr('보통', 'Busy'), high: () => tr('바쁨', 'Heavy') },
  mem: { ok: () => tr('여유', 'Fine'), warn: () => tr('빠듯', 'Tight'), high: () => tr('부족', 'Low') },
  disk: { ok: () => tr('여유', 'Fine'), warn: () => tr('빠듯', 'Tight'), high: () => tr('부족', 'Low') },
};
const NAME: Record<CardItem['key'], () => string> = { cpu: () => 'CPU', mem: () => tr('메모리', 'Memory'), disk: () => tr('저장공간', 'Storage') };
const gb = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}GB`;

/** 자원 한 줄 설명 — 문구 Sonnet medium(2026-11-01) */
function sub(it: CardItem, s: SysLoad): string {
  const load = s.load1.toFixed(1);
  if (it.key === 'cpu') {
    if (it.lv === 'high') return tr(`코어 ${s.cores}개에 일이 몰림 · 부하 ${load}`, `Work piled on ${s.cores} cores · load ${load}`);
    if (it.lv === 'warn') return tr(`코어 수만큼 일이 차 있어요 · 부하 ${load}`, `Work fills every core · load ${load}`);
    return tr(`부하 ${load} / 코어 ${s.cores}`, `Load ${load} on ${s.cores} cores`);
  }
  const swap = gb(s.swapUsedMb / 1024);
  if (it.key === 'mem') {
    if ((s.memPressure ?? 1) >= 2) return tr('모자라서 느려질 수 있어요', 'Running short — may slow down');
    const free = s.memFreePct !== undefined ? gb((s.memTotalMb / 1024) * s.memFreePct / 100) : null;
    if (it.lv !== 'ok') return tr(`스왑 ${swap} 씀, 아직 압박은 없어요`, `${swap} swap used, no pressure yet`);
    return free ? tr(`여유 ${free}, 스왑 ${swap} 씀`, `${free} free, ${swap} swap`) : tr(`스왑 ${swap} 씀`, `${swap} swap`);
  }
  const left = gb(s.diskFreeGb ?? 0);
  if (it.lv === 'high') return tr(`${left} 남음, 거의 찼어요`, `${left} left, almost full`);
  if (it.lv === 'warn') return tr(`${left} 남음, 정리해 두면 좋아요`, `${left} left, worth a cleanup`);
  return tr(`${left} 남음`, `${left} left`);
}

/** 카드 머리 한 문장 — 원인 먼저 */
function headline(bad: CardItem[], s: SysLoad): string {
  if (!bad.length) return tr('지금 여유로워요', 'All clear');
  return bad.map((x) => (x.key === 'disk' ? tr(`저장공간 ${gb(s.diskFreeGb ?? 0)} 남음`, `${gb(s.diskFreeGb ?? 0)} storage left`) : `${NAME[x.key]()} ${WORD[x.key][x.lv]()}`)).join(' · ');
}

const CAUSE: Record<CardItem['key'], () => React.ReactElement> = { cpu: IconCpu, mem: IconMemory, disk: IconDisk };

/** 칩 얼굴 — 게이지 바늘이 한가·보통·바쁨, 원인 아이콘은 탈 났을 때만 옆에(icons-states.png 1안, 2026-11-01 사용자) */
function Face({ lv, bad }: { lv: Lv; bad: CardItem[] }) {
  return <>
    <span className={`lc-ic ${lv}`}><IconGauge lv={lv} /></span>
    {bad.map((x) => { const I = CAUSE[x.key]; return <span key={x.key} className={`lc-ic ${x.lv}`}><I /></span>; })}
  </>;
}

/**
 * 위 띠 부하 칩 — 늘 보인다. 올리면 카드(문제를 위로, 괜찮은 건 한 줄, 저장공간 정리), 누르면 자세히 보기(떠 있는 창).
 * 2026-11-01 사용자: "CPU인지 메모리인지 스토리지인지", 부하 화면이 가운데를 덮는 건 과하다
 */
export function LoadChip({ sys, report, detailOn, onDetail, onHover, onClean, onOpenSession }: Props) {
  const chip = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<DOMRect | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const card = loadCard(sys, report);
  const open = (now = false) => {
    window.clearTimeout(timer.current);
    const go = () => { if (chip.current) setAt(chip.current.getBoundingClientRect()); };
    if (now) go(); else timer.current = window.setTimeout(go, 150);
  };
  const close = (now = false) => {
    window.clearTimeout(timer.current);
    if (now) setAt(null); else timer.current = window.setTimeout(() => setAt(null), 220);
  };
  useEffect(() => { hoverRef.current(!!at); if (!at) setSent(null); }, [at]);
  useEffect(() => {
    if (!at) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [at]);
  useEffect(() => () => { window.clearTimeout(timer.current); hoverRef.current(false); }, []);
  const clean = async () => {
    const text = tr(`저장공간이 ${gb(sys.diskFreeGb ?? 0)} 남았어. 안 쓰는 파일 정리 좀 해줘`, `Only ${gb(sys.diskFreeGb ?? 0)} of storage left. Can you clean up files I don't need?`);
    try { await onClean(text); setSent(tr(`${assistant()}에게 전했어요`, `Sent to ${assistant()}`)); } catch (e) { setSent(String(e)); }
  };
  return <>
    <button ref={chip} type="button" className={`load-chip ${card.lv} ${detailOn || at ? 'on' : ''}`}
      aria-label={tr(`이 맥 ${headline(card.bad, sys)} — 누르면 자세히 보기`, `This Mac: ${headline(card.bad, sys)} — click for details`)}
      aria-expanded={detailOn} onMouseEnter={() => open()} onMouseLeave={() => close()} onFocus={() => open(true)} onBlur={() => close()}
      onClick={(e) => { close(true); onDetail(e.currentTarget.getBoundingClientRect()); }}>
      <Face lv={card.lv} bad={card.bad} />
    </button>
    {at && !detailOn && (
      <div className="lc-card" role="dialog" aria-label={tr('이 맥 상태', 'This Mac')} style={{ top: at.bottom + 6, left: Math.max(8, Math.min(at.left - 8, window.innerWidth - 340)) }}
        onMouseEnter={() => open(true)} onMouseLeave={() => close()}>
        <div className="lc-head">
          <b>{headline(card.bad, sys)}</b>
          <button type="button" className="lc-ib" aria-label={tr('세션별 부하 보기', 'Load by session')} title={tr('세션별 부하 보기', 'Load by session')}
            onClick={() => { const a = chip.current?.getBoundingClientRect(); close(true); if (a) onDetail(a); }}><IconOpen /></button>
        </div>
        {card.bad[0] && <div className={`lc-bad ${card.bad[0].lv}`}>
          {card.bad.map((it) => (
            <div key={it.key} className={`lc-item ${it.lv}`}>
              <span className="lc-tx"><b>{NAME[it.key]()} {WORD[it.key][it.lv]()}</b><span>{sub(it, sys)}</span></span>
              {it.clean
                ? <button type="button" className="lc-ib" aria-label={tr(`${assistant()}에게 정리 부탁`, `Ask ${assistant()} to clean up`)} title={tr(`${assistant()}에게 정리 부탁`, `Ask ${assistant()} to clean up`)} onClick={() => void clean()}><IconTrash /></button>
                : it.num && <span className="lc-num">{it.num}</span>}
            </div>
          ))}
          {sent && <div className="lc-sent">{sent}</div>}
        </div>}
        {card.good.map((it) => (
          <div key={it.key} className="lc-good"><span className="lc-dot ok" /><b>{NAME[it.key]()} {WORD[it.key].ok()}</b><span>{sub(it, sys)}</span></div>
        ))}
        {card.sessions.length > 0 && <>
          <div className="lc-sec">{tr('많이 쓰는 세션', 'Heaviest sessions')}</div>
          {card.sessions.map((s) => (
            <button key={s.id} type="button" className="lc-ses" title={s.project} onClick={() => { close(true); onOpenSession(s.id); }}>
              <b>{seenName(s.name)}</b><span>{s.project}</span><em>{Math.round(s.cpu)}%</em><u>{fmtMem(s.rssKb)}</u>
            </button>
          ))}
          {card.rest && <div className="lc-ses rest"><b>{tr('그 밖의 앱', 'Other apps')}</b><span /><em>{card.rest.cpu}%</em><u>{fmtMem(card.rest.rssKb)}</u></div>}
        </>}
      </div>
    )}
  </>;
}

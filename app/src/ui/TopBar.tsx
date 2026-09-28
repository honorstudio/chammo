import type { Limit, Usage } from '../domain/usage';
import { fmtResetIn } from '../domain/usage';
import type { RepoToday } from '../data/tauri';
import type { TamaFile } from '../domain/tama/store';
import { TamaMini } from './tama/TamaMini';
import type { Features } from '../domain/config';
import { IconBell, IconGear, IconOffice, IconReader, IconReplay, IconSpeaker } from './Icons';
import { assistant, tr } from '../i18n';

const level = (left: number) => (left >= 50 ? 'ok' : left >= 20 ? 'mid' : 'low');

function Meter({ label, l }: { label: string; l?: Limit }) {
  if (!l) return <span className="meter dim">{label} —</span>;
  return (
    <span className="meter" title={l.resetIn != null ? tr(`${fmtResetIn(l.resetIn)} 뒤 초기화`, `Resets in ${fmtResetIn(l.resetIn)}`) : undefined}>
      <span className="m-label">{label}</span>
      <span className="m-track"><span className={`m-fill ${level(l.left)}`} style={{ width: `${Math.max(2, l.left)}%` }} /></span>
      <b>{l.left}%</b>
      {l.resetIn != null && <span className="dim">{fmtResetIn(l.resetIn)}</span>}
    </span>
  );
}

/** 앱 맨 위: Claude 사용 한도 · 오늘 커밋 · (오른쪽) 다마고치 자리 */
type TamaProps = { file: TamaFile | null; widgetShown: boolean; onToggle: () => void };

export function TopBar({ features, usage, today, tama, inboxCount, onInbox, onSettings, voice, onVoice, replayOn, onReplay, office, onOffice, reader, onReader, load, onLoad, loadOn }: { load?: { level: 'ok' | 'warn' | 'high'; load1: number; cores: number; swapGb: number }; onLoad: () => void; loadOn: boolean; features: Features; usage: Usage; today: RepoToday[]; tama: TamaProps; inboxCount: number; onInbox: () => void; onSettings: () => void; voice: boolean; onVoice: () => void; replayOn: boolean; onReplay: () => void; office: boolean; onOffice: () => void; reader: boolean; onReader: () => void }) {
  const commits = today.reduce((n, r) => n + r.commits, 0);
  const added = today.reduce((n, r) => n + r.added, 0);
  const deleted = today.reduce((n, r) => n + r.deleted, 0);
  const detail = today.map((r) => tr(`${r.name} ${r.commits}개 +${r.added} −${r.deleted}`, `${r.name} ${r.commits} commits +${r.added} −${r.deleted}`)).join('\n');
  return (
    <header className="topbar">
      <Meter label={tr('5시간', '5h')} l={usage.five} />
      <Meter label={tr('주간', 'Week')} l={usage.week} />
      <span className="sep" />
      <span className="today" title={detail || tr('오늘(새벽 5시부터) 커밋 없음', 'No commits today (since 5 AM)')}>
        <span className="m-label">{tr('오늘 커밋', 'Commits today')}</span>
        <b>{commits}</b>
        {commits > 0 && (
          <span className="dim">
            <span className="plus">+{added}</span> <span className="minus">−{deleted}</span> · {tr('저장소', 'repos')} {today.length}
          </span>
        )}
      </span>
      {load && <>
        <span className="sep" />
        <button type="button" className={`load-chip ${load.level} ${loadOn ? 'on' : ''}`} onClick={onLoad}
          title={tr(`1분 부하 ${load.load1.toFixed(1)} / 코어 ${load.cores}개 · 스왑 ${load.swapGb.toFixed(1)}GB — 눌러서 세션별로 보기`, `Load ${load.load1.toFixed(1)} on ${load.cores} cores · swap ${load.swapGb.toFixed(1)}GB — click for a per-session view`)}>
          <span className="m-label">{tr('부하', 'Load')}</span>
          <b>{load.load1.toFixed(1)}</b>
          <span className="dim">/ {load.cores} · {tr('스왑', 'swap')} {load.swapGb.toFixed(1)}G</span>
        </button>
      </>}
      <span className="grow" />
      {features.tama && <TamaMini file={tama.file} onOpen={tama.onToggle} on={tama.widgetShown} />}
      {features.office && <button className={`voice ${office ? 'on' : ''}`} title={office
        ? tr(`사무실 모드 켜짐 — ${assistant()} 화면이 픽셀 사무실로 (눌러서 끄기)`, `Office mode on — ${assistant()}'s screen is a pixel office (click to turn off)`)
        : tr(`사무실 모드 — ${assistant()} 화면을 픽셀 사무실로 (눌러서 켜기)`, `Office mode — show ${assistant()}'s screen as a pixel office (click to turn on)`)} aria-label={tr('사무실 모드', 'Office mode')} aria-pressed={office} onClick={onOffice}>
        <IconOffice />
      </button>}
      <button className={`voice ${reader ? 'on' : ''}`} title={reader ? tr('리더 패널 닫기 (⌘E)', 'Close reader panel (⌘E)') : tr('리더 패널 — 시안·PDF·문서 (⌘E)', 'Reader panel — designs, PDFs, docs (⌘E)')} aria-label={tr('리더 패널', 'Reader panel')} aria-pressed={reader} onClick={onReader}>
        <IconReader />
      </button>
      <button className={`voice ${replayOn ? 'on' : ''}`} title={tr('하루 리플레이 — 오늘 한 일 돌려보기', "Day replay — replay today's work")} aria-label={tr('하루 리플레이', 'Day replay')} aria-pressed={replayOn} onClick={onReplay}>
        <IconReplay />
      </button>
      {features.voice && <button className={`voice ${voice ? 'on' : ''}`} title={voice
        ? tr(`음성 모드 켜짐 — ${assistant()}가 답하면 소리로 읽어줘 (눌러서 끄기)`, `Voice mode on — ${assistant()}'s replies are read aloud (click to turn off)`)
        : tr(`음성 모드 — ${assistant()} 답을 소리로 (눌러서 켜기)`, `Voice mode — read ${assistant()}'s replies aloud (click to turn on)`)} aria-label={tr('음성 모드', 'Voice mode')} aria-pressed={voice} onClick={onVoice}>
        <IconSpeaker />
      </button>}
      {/* 설정: 사이드바 아래에 두면 ⌘B 로 닫았을 때 못 찾는다(사용자) */}
      <button className="voice" title={tr('설정 (⌘,)', 'Settings (⌘,)')} aria-label={tr('설정 (⌘,)', 'Settings (⌘,)')} onClick={onSettings}>
        <IconGear />
      </button>
      {/* 맨 끝: 결정 대기 드롭다운이 바로 아래(오른쪽 위)에 펼쳐진다 */}
      <button className={`bell ${inboxCount ? 'on' : ''}`} title={inboxCount ? tr(`결정 대기 ${inboxCount}개 — 눌러서 보기`, `${inboxCount} decisions waiting — click to view`) : tr('결정 대기 없음', 'No decisions waiting')} onClick={onInbox}>
        <IconBell />
        {inboxCount > 0 && <span className="bell-n">{inboxCount}</span>}
      </button>
    </header>
  );
}

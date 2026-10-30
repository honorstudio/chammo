import { useRef, useState } from 'react';
import type { Limit, Usage } from '../domain/usage';
import { fmtResetIn, usageLevel } from '../domain/usage';
import type { RepoToday } from '../data/tauri';
import type { TamaFile } from '../domain/tama/store';
import { TamaMini } from './tama/TamaMini';
import type { Features } from '../domain/config';
import { IconBell, IconOffice, IconReader, IconSpace, IconTerminal } from './Icons';
import { featureButton, type FeatureProps } from './FeatureButtons';
import { barItems, type BarItem } from '../domain/topbarMenu';
import { assistant, tr } from '../i18n';
import { ageText, allOut, type AccountsView } from '../domain/accounts';
import { AccountPopover } from './AccountPopover';
import { Badge } from './kit/Badge';


/** 남은 % 막대 — 남은 시간·몇 분 전 값인지는 마우스를 올리면(글자가 많다, 2026-10-02 사용자). 자세한 건 계정 칩 팝오버 */
function Meter({ label, l, age }: { label: string; l?: Limit; age?: number | null }) {
  if (!l) return <span className="meter dim">{label} —</span>;
  const title = [l.resetIn != null ? tr(`${fmtResetIn(l.resetIn)} 뒤 초기화`, `Resets in ${fmtResetIn(l.resetIn)}`) : '', age != null && age >= 60_000 ? tr(`${ageText(age)} 확인한 값`, `checked ${ageText(age)}`) : ''].filter(Boolean).join(' · ');
  return (
    <span className="meter" title={title || undefined}>
      <span className="m-label">{label}</span>
      <span className="m-track"><span className={`m-fill ${usageLevel(l.left)}`} style={{ width: `${Math.max(2, l.left)}%` }} /></span>
      <b>{l.left}%</b>
    </span>
  );
}

/** 앱 맨 위: Claude 사용 한도 · 오늘 커밋 · (오른쪽) 다마고치 자리 */
type TamaProps = { file: TamaFile | null; widgetShown: boolean; onToggle: () => void };

export function TopBar({ features, usage, usageAge, account, accounts, onSettings, today, tama, inboxCount, onInbox, harnitor, onHarnitor, tools, onTools, review, onReview, voice, onVoice, replayOn, onReplay, office, onOffice, space, onView, reader, onReader, load, onLoad, loadOn, claude, fontSize }: { /** 계정 팝오버 '로그인해서 바꾸기' 터미널 — claude 경로·글자 크기 */ claude?: string | null; fontSize: number; load?: { level: 'ok' | 'warn' | 'high'; load1: number; cores: number; swapGb: number }; onLoad: () => void; loadOn: boolean; features: Features; usage: Usage; usageAge?: number | null; account: { name: string; title: string; known: boolean } | null; accounts: AccountsView | null; onSettings: () => void; today: RepoToday[]; tama: TamaProps; inboxCount: number; onInbox: () => void; harnitor: boolean; onHarnitor: () => void; /** 도구 화면이 지금 탭에 떠 있나 */ tools: boolean; onTools: () => void; /** 리뷰 — on = 리뷰 화면이 떠 있나, confirm = 머지 전에 사람이 볼 PR 수 */ review: { on: boolean; confirm: number }; onReview: () => void; voice: boolean; onVoice: () => void; replayOn: boolean; onReplay: () => void; office: boolean; onOffice: () => void; /** 지금 뷰가 채팅 뷰인가 */ space: boolean; onView: (chat: boolean) => void; reader: boolean; onReader: () => void }) {
  const commits = today.reduce((n, r) => n + r.commits, 0);
  const added = today.reduce((n, r) => n + r.added, 0);
  const deleted = today.reduce((n, r) => n + r.deleted, 0);
  const detail = today.map((r) => tr(`${r.name} ${r.commits}개 +${r.added} −${r.deleted}`, `${r.name} ${r.commits} commits +${r.added} −${r.deleted}`)).join('\n');
  const chip = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState<DOMRect | null>(null);
  const out = allOut(accounts, Date.now());
  return (
    <header className="topbar">
      <Meter label={tr('5시간', '5h')} l={usage.five} age={usageAge} />
      <Meter label={tr('주간', 'Week')} l={usage.week} age={usageAge} />
      {account && <button ref={chip} type="button" className={`acct-chip ${account.known ? '' : 'unknown'} ${pop ? 'on' : ''}`} title={[account.title, out].filter(Boolean).join(' — ')}
        aria-haspopup="dialog" aria-expanded={!!pop} onClick={(e) => setPop(pop ? null : e.currentTarget.getBoundingClientRect())}>
        <b>{account.name}</b>
        {out && <span className="dim">{tr('다 소진', 'All used')}</span>}
      </button>}
      {pop && accounts && <AccountPopover view={accounts} anchor={pop} chip={chip} claude={claude} fontSize={fontSize} onClose={() => setPop(null)} onSettings={() => { setPop(null); onSettings(); }} />}
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
          title={tr(`부하 ${load.load1.toFixed(1)} (코어 ${load.cores}개) · 스왑 ${load.swapGb.toFixed(1)}GB. 누르면 세션별로 봐요`, `Load ${load.load1.toFixed(1)} on ${load.cores} cores · swap ${load.swapGb.toFixed(1)}GB. Click for a per-session view`)}>
          <span className="m-label">{tr('부하', 'Load')}</span>
          <b>{load.load1.toFixed(1)}</b>
          <span className="dim">/ {load.cores} · {tr('스왑', 'swap')} {load.swapGb.toFixed(1)}G</span>
        </button>
      </>}
      <span className="grow" />
      {(() => {
        // 뷰마다 쓰는 아이콘만 — 순서는 domain/topbarMenu 표(그 뷰에서만 쓰는 것은 토글 왼쪽, 공통은 오른쪽)
        const fp: FeatureProps = { voice, onVoice, replayOn, onReplay, tools, onTools, harnitor, onHarnitor, review, onReview };
        const item: Record<BarItem, React.ReactNode> = {
          tama: <TamaMini key="tama" file={tama.file} onOpen={tama.onToggle} on={tama.widgetShown} />,
          office: <button key="office" className={`voice ${office ? 'on' : ''}`} title={space
            ? (office ? tr('사무실 — 스페이스 칸이 사무실 (눌러서 스페이스로, ⌘4)', 'Office — the space shows the office (click for space, ⌘4)') : tr('사무실 — 스페이스 칸을 사무실로 (⌘4)', 'Office — show the office in the space (⌘4)'))
            : (office ? tr(`사무실 모드 켜짐 — ${assistant()} 화면이 픽셀 사무실로 (눌러서 끄기)`, `Office mode on — ${assistant()}'s screen is a pixel office (click to turn off)`) : tr(`사무실 모드 — ${assistant()} 화면을 픽셀 사무실로 (⌘4)`, `Office mode — show ${assistant()}'s screen as a pixel office (⌘4)`))}
            aria-label={tr('사무실', 'Office')} aria-pressed={office} onClick={onOffice}><IconOffice /></button>,
          reader: <button key="reader" className={`voice ${reader ? 'on' : ''}`} title={reader ? tr('리더 패널 닫기 (⌘E)', 'Close reader panel (⌘E)') : tr('리더 (⌘E)', 'Reader (⌘E)')} aria-label={tr('리더 패널', 'Reader panel')} aria-pressed={reader} onClick={onReader}><IconReader /></button>,
          // 기록·음성·도구·하니터·리뷰 — 터미널 뷰만(채팅 뷰는 왼쪽 참모 패널, domain/topbarMenu rail)
          replay: featureButton('replay', fp, 'voice'), voice: featureButton('voice', fp, 'voice'), tools: featureButton('tools', fp, 'voice'),
          harnitor: featureButton('harnitor', fp, 'voice'), review: featureButton('review', fp, 'voice'),
          // 맨 끝: 결정 대기 드롭다운이 바로 아래(오른쪽 위)에 펼쳐진다
          inbox: <button key="inbox" className={`bell ${inboxCount ? 'on' : ''}`} aria-label={inboxCount ? tr(`결정 대기 ${inboxCount}개`, `${inboxCount} decisions waiting`) : tr('결정 대기', 'Decisions')} title={inboxCount ? tr(`결정 대기 ${inboxCount}개 — 눌러서 보기`, `${inboxCount} decisions waiting — click to view`) : tr('결정 대기 없음', 'No decisions waiting')} onClick={onInbox}>
            <IconBell />
            <Badge n={inboxCount} className="bell-n" />
          </button>,
        };
        const { before, after } = barItems(space ? 'chat' : 'terminal', features);
        return <>
          {before.map((id) => item[id])}
          {/* 채팅 | 터미널 — 지금 뷰가 칠해진다. 두 뷰가 아예 달라져서 켜고 끄는 단추 대신 두 칸(2026-10-03 사용자) */}
          <span className="view-seg" role="group" aria-label={tr('보기', 'View')}>
            <button className={space ? 'on' : ''} aria-pressed={space} aria-label={tr('채팅 뷰', 'Chat view')} title={tr(`채팅 뷰 — 가운데 ${assistant()} 채팅, 오른쪽 스페이스`, `Chat view — ${assistant()} chat in the middle, space on the right`)} onClick={() => onView(true)}><IconSpace /></button>
            <button className={space ? '' : 'on'} aria-pressed={!space} aria-label={tr('터미널 뷰', 'Terminal view')} title={tr('터미널 뷰', 'Terminal view')} onClick={() => onView(false)}><IconTerminal /></button>
          </span>
          {after.map((id) => item[id])}
        </>;
      })()}
    </header>
  );
}

import { useRef, useState } from 'react';
import type { Limit, Usage } from '../domain/usage';
import { fmtResetIn, usageLevel } from '../domain/usage';
import type { CodeToday } from '../domain/replay';
import type { TaskEvent } from '../domain/tasks';
import { TodayChip } from './TodayChip';
import type { Features } from '../domain/config';
import { IconBell, IconNotebook, IconOffice, IconReader, IconSpace, IconTerminal } from './Icons';
import { featureButton, type FeatureProps } from './FeatureButtons';
import { barItems, type BarItem } from '../domain/topbarMenu';
import { assistant, tr } from '../i18n';
import { LoadChip } from './LoadChip';
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

/** Claude 한도 칸 — 5시간 한도가 없는 요금제(Ultra)면 5시간 자리에 요금제 이름(화면에서 대문자, 막대 없이). 못 읽음은 '—' 그대로 */
export function LimitMeters({ usage, age }: { usage: Usage; age?: number | null }) {
  const plan = usage.noFive;
  return (
    <>
      <span className="m-label">{tr('Claude 한도', 'Claude limit')}</span>
      {plan !== undefined && !usage.five
        ? <span className="meter plan" title={tr(`${plan} 요금제는 5시간 한도가 없어요. 주간 한도만 봐요`, `${plan} has no 5-hour limit. Only the weekly limit applies`)}
            aria-label={tr(`5시간 한도 없음, ${plan} 요금제`, `No 5-hour limit, ${plan} plan`)}><b>{plan || tr('없음', 'none')}</b></span>
        : <Meter label={tr('5시간', '5h')} l={usage.five} age={age} />}
      <Meter label={tr('주간', 'Week')} l={usage.week} age={age} />
    </>
  );
}

/** 앱 맨 위: Claude 사용 한도 · 부하·오늘 한 일 아이콘 · (오른쪽) 다마고치 자리 */

export function TopBar({ notesOn, onNotes, features, usage, usageAge, account, accounts, onSettings, today, tasks, onToday, inboxCount, inboxHot = true, onInbox, harnitor, onHarnitor, tools, onTools, review, onReview, voice, onVoice, replayOn, onReplay, office, onOffice, space, onView, reader, onReader, load, claude, fontSize, fresh = false }: {
  /** 내 메모 — 패널이나 따로 창이 떠 있나 · 머리줄 아이콘·⌘⇧M */
  notesOn: boolean;
  onNotes: () => void;
 /** 참모가 하나도 없음(첫 날) — 한도·커밋 숫자를 숨긴다(ux-start M6) */ fresh?: boolean; /** 계정 팝오버 '로그인해서 바꾸기' 터미널 — claude 경로·글자 크기 */ claude?: string | null; fontSize: number; load?: React.ComponentProps<typeof LoadChip>; features: Features; usage: Usage; usageAge?: number | null; account: { name: string; title: string; known: boolean } | null; accounts: AccountsView | null; onSettings: () => void; /** 오늘 코드 숫자 — git 을 끈 사람은 0 */ today: CodeToday; /** 일 기록 — 오늘 끝낸 일을 센다 */ tasks: TaskEvent[]; /** 오늘 한 일 아이콘을 누름 — 하루 기록 열기 */ onToday: () => void; inboxCount: number; /** 결제·운영 카드가 있나 — 없으면 종 숫자를 회색으로(그냥 물음만) */ inboxHot?: boolean; onInbox: () => void; harnitor: boolean; onHarnitor: () => void; /** 도구 화면이 지금 탭에 떠 있나 */ tools: boolean; onTools: () => void; /** 리뷰 — on = 리뷰 화면이 떠 있나, confirm = 머지 전에 사람이 볼 PR 수 */ review: { on: boolean; confirm: number }; onReview: () => void; voice: boolean; onVoice: () => void; replayOn: boolean; onReplay: () => void; office: boolean; onOffice: () => void; /** 지금 뷰가 채팅 뷰인가 */ space: boolean; onView: (chat: boolean) => void; reader: boolean; onReader: () => void }) {
  const chip = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState<DOMRect | null>(null);
  const out = allOut(accounts, Date.now());
  return (
    <header className="topbar">
      {/* 첫 날(참모 0명)엔 한도·오늘 한 일을 숨기고, 한도엔 무엇인지 이름(2026-11-01 ux-start M6) */}
      {!fresh && <>
      <LimitMeters usage={usage} age={usageAge} />
      </>}
      {account && <button ref={chip} type="button" className={`acct-chip ${account.known ? '' : 'unknown'} ${pop ? 'on' : ''}`} title={[account.title, out].filter(Boolean).join(' — ')}
        aria-haspopup="dialog" aria-expanded={!!pop} onClick={(e) => setPop(pop ? null : e.currentTarget.getBoundingClientRect())}>
        <b>{account.name}</b>
        {out && <span className="dim">{tr('다 소진', 'All used')}</span>}
      </button>}
      {pop && accounts && <AccountPopover view={accounts} anchor={pop} chip={chip} claude={claude} fontSize={fontSize} onClose={() => setPop(null)} onSettings={() => { setPop(null); onSettings(); }} />}
      {(load || !fresh) && <>
        {(!fresh || account) && <span className="sep" />}
        <span className="tdy-group">
          {/* 늘 보인다 — 올리면 카드, 누르면 자세히 보기(2026-11-01 사용자 "내 피씨가 어느 정도 상태인지 팔로우가 안 됨") */}
          {load && <LoadChip {...load} />}
          {/* 고정 글자 '오늘 커밋' 대신 아이콘 — 누구에겐 불필요해서, 개발 중인 사람만 칸에 코드 숫자(2026-11-05 사용자) */}
          {!fresh && <TodayChip events={tasks} code={today} onOpen={onToday} />}
        </span>
      </>}
      <span className="grow" />
      {(() => {
        // 뷰마다 쓰는 아이콘만 — 순서는 domain/topbarMenu 표(그 뷰에서만 쓰는 것은 토글 왼쪽, 공통은 오른쪽)
        const fp: FeatureProps = { voice, onVoice, replayOn, onReplay, tools, onTools, harnitor, onHarnitor, review, onReview };
        const item: Record<BarItem, React.ReactNode> = {
          office: <button key="office" className={`voice ${office ? 'on' : ''}`} title={space
            ? (office ? tr('사무실 — 스페이스 칸이 사무실 (눌러서 스페이스로, ⌘4)', 'Office — the space shows the office (click for space, ⌘4)') : tr('사무실 — 스페이스 칸을 사무실로 (⌘4)', 'Office — show the office in the space (⌘4)'))
            : (office ? tr(`사무실 모드 켜짐 — ${assistant()} 화면이 픽셀 사무실로 (눌러서 끄기)`, `Office mode on — ${assistant()}'s screen is a pixel office (click to turn off)`) : tr(`사무실 모드 — ${assistant()} 화면을 픽셀 사무실로 (⌘4)`, `Office mode — show ${assistant()}'s screen as a pixel office (⌘4)`))}
            aria-label={tr('사무실', 'Office')} aria-pressed={office} onClick={onOffice}><IconOffice /></button>,
          reader: <button key="reader" className={`voice ${reader ? 'on' : ''}`} title={reader ? tr('리더 패널 닫기 (⌘E)', 'Close reader panel (⌘E)') : tr('리더 (⌘E)', 'Reader (⌘E)')} aria-label={tr('리더 패널', 'Reader panel')} aria-pressed={reader} onClick={onReader}><IconReader /></button>,
          // 기록·음성·도구·하니터·리뷰 — 터미널 뷰만(채팅 뷰는 왼쪽 참모 패널, domain/topbarMenu rail)
          replay: featureButton('replay', fp, 'voice'), voice: featureButton('voice', fp, 'voice'), tools: featureButton('tools', fp, 'voice'),
          harnitor: featureButton('harnitor', fp, 'voice'), review: featureButton('review', fp, 'voice'),
          notes: <button key="notes" className={`voice ${notesOn ? 'on' : ''}`} aria-pressed={notesOn} aria-label={tr('내 메모', 'My notes')} title={tr('내 메모 (⌘⇧M)', 'My notes (⌘⇧M)')} onClick={onNotes}><IconNotebook /></button>,
          // 맨 끝: 결정 대기 드롭다운이 바로 아래(오른쪽 위)에 펼쳐진다
          inbox: <button key="inbox" className={`bell ${inboxCount ? (inboxHot ? 'on' : 'calm') : ''}`} aria-label={inboxCount ? tr(`결정 대기 ${inboxCount}개`, `${inboxCount} decisions waiting`) : tr('결정 대기', 'Decisions')} title={inboxCount ? tr(`결정 대기 ${inboxCount}개 — 눌러서 보기`, `${inboxCount} decisions waiting — click to view`) : tr('결정 대기 없음', 'No decisions waiting')} onClick={onInbox}>
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

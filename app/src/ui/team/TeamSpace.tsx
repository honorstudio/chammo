// 팀 모드 오른쪽 스페이스(시안 team-space v1 A, 10-26 사용자 "추천대로") — 탭 줄: 팀 홈 · 팀 보관함 · 연 파일 탭 · 끝에 팀 설정.
// 참모 탭 줄(홈·보관함·Craft 독)과 따로다 — 팀에서 연 파일·참모 앱 칸(열쇠 k:<앱>, domain/teamCraft)은 이 줄에만 붙고 닫으면 연 곳(domain/teamSpace)으로
import { reviseSrc, roomOfTab, type TeamTabs } from '../../domain/teamSpace';
import { tr } from '../../i18n';
import { IconClose, IconFolder, IconHome, IconPanelLeft, IconSettings } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { TabStrip } from '../space/TabStrip';

const nameOf = (p: string) => p.split('/').pop() || p;

export function TeamSpace({ tabs, onPick, onClose, onSettings, onHide, onUnfold, home, locker, file, roomFiles, roomName, tabName, revise }: {
  tabs: TeamTabs;
  onPick: (k: string) => void;
  onClose: (path: string) => void;
  /** 팀 설정 팝오버 — 누른 단추 자리 */
  onSettings: (at: DOMRect) => void;
  /** 좁은 메신저 창 — 이 칸 접기 */
  onHide?: () => void;
  /** 메신저(목록·대화)를 접어 둔 동안 — 탭 줄 맨 앞에 펴기 */
  onUnfold?: () => void;
  home: React.ReactNode;
  locker: React.ReactNode;
  /** 연 파일 화면(스페이스 filePage — md·엑셀 편집, 그 밖 미리보기) */
  file: (path: string) => React.ReactNode;
  /** 대화 파일 보기(탭 열쇠 files:<방>) — 그 방 파일 목록 */
  roomFiles?: (room: string) => React.ReactNode;
  /** 대화 파일 보기 탭 이름(상대·팀챗 이름) */
  roomName?: (room: string) => string;
  /** 탭 이름을 따로 줄 열쇠(참모 앱 칸 → 앱 이름) — 없으면 파일 이름 */
  tabName?: (key: string) => string | undefined;
  /** 보던 탭의 팀 파일을 고쳤으면 '팀 보관함에 수정본 올리기'(ReviseBar) */
  revise?: (path: string) => React.ReactNode;
}) {
  const cur = tabs.cur;
  return (
    <div className="lk-main tsp-main">
      <div className="lk-center">
        <nav className="lk-tabs" aria-label={tr('팀 스페이스', 'Team space')}>
          {onUnfold && <IconButton label={tr('메신저 펴기', 'Expand the messenger')} onClick={onUnfold}><IconPanelLeft /></IconButton>}
          <button className={`lk-tab home ${cur === 'home' ? 'on' : ''}`} aria-pressed={cur === 'home'} onClick={() => onPick('home')} aria-label={tr('팀 홈', 'Team home')} title={tr('팀 홈', 'Team home')}><IconHome /></button>
          <button className={`lk-tab folder ${cur === 'locker' ? 'on' : ''}`} aria-pressed={cur === 'locker'} onClick={() => onPick('locker')} aria-label={tr('팀 보관함', 'Team locker')} title={tr('팀 보관함', 'Team locker')}><IconFolder /></button>
          <TabStrip on={cur}>
            {tabs.files.map(({ path }) => (
              <span key={path} className={`lk-tab ${cur === path ? 'on' : ''}`} role="tab" aria-selected={cur === path} tabIndex={0} title={path}
                onClick={() => onPick(path)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(path); }}>
                <span>{roomOfTab(path) ? tr(`${roomName?.(roomOfTab(path)) ?? ''} 파일`, `${roomName?.(roomOfTab(path)) ?? ''} files`) : tabName?.(path) ?? nameOf(path)}</span>
                <IconButton size="s" label={tr('탭 닫기', 'Close tab')} onClick={(e) => { e.stopPropagation(); onClose(path); }}><IconClose /></IconButton>
              </span>
            ))}
          </TabStrip>
          <span className="tsp-end">
            <IconButton label={tr('팀 설정', 'Team settings')} aria-haspopup="dialog" onClick={(e) => onSettings(e.currentTarget.getBoundingClientRect())}><IconSettings /></IconButton>
            {onHide && <IconButton label={tr('팀 홈·보관함 칸 닫기', 'Close the team panel')} onClick={onHide}><IconClose /></IconButton>}
          </span>
        </nav>
        {revise && reviseSrc(tabs) && revise(reviseSrc(tabs))}
        {cur === 'home' ? home : cur === 'locker' ? <div className="lk-doc-body">{locker}</div> : roomOfTab(cur) && roomFiles ? <div className="lk-doc-body">{roomFiles(roomOfTab(cur))}</div> : <div className="lk-doc-body">{file(cur)}</div>}
      </div>
    </div>
  );
}

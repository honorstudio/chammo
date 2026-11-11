import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TtsField } from './TtsField';
import { baseTools, setGitIdentity, appVersion, trustFolders, browserSetupStart, browserSetupState, browserStatus, checkEnv, claudeTrusted, projectAccess, notifyOpenSettings, notifyRequest, notifyStatus, axTrusted, screenTrusted, askPermission, createHq, folderStatus, getAppEnv, makeDir, openTarget, pickFolder, rebuildMenu, writeConfig, type Config, type FolderStatus } from '../data/tauri';
import { addExtraProject, addOpenFolder, claudeSignedInText, parseClaudeVersion, setupCommand, winSetupNotes, tildify, notifyRow, axRow, browserRow, browserChecklist, ghRow, gitIdentityRow, gitIdentityError, installState, loginRow, GET_URL, setupFailed, versionFit, type BrowserSetupState, type BrowserStatus, type EnvCheck, type NotifyStatus, type SetupTask, type SkipKey, type Trust } from '../domain/setup';
import type { Animation, FeatureSwitch } from '../domain/config';
import { firstTab, settingsEscCloses, settingsTabs, tabOf, type SettingsTab, type SetupStart } from '../domain/settingsTabs';
import { BRAND } from '../domain/avatar';
import { josa, machine, tr, type Lang } from '../i18n';
import { TerminalPane } from './TerminalPane';
import { FULL_DISK_URL, wizardAccess, type Access } from '../domain/access';
import { AccountsSection } from './AccountsSection';
import { MobileSection } from './MobileSection';
import { DevicesSection } from './DevicesSection';
import { PeerSection } from './PeerSection';
import { TeamAccountSection } from './TeamAccountSection';
import { TeamSoundSection } from './team/TeamSoundSection';
import { MessengerSection } from './MessengerSection';
import { mirrorConfig as mirror, reloadApp as reopen } from './setupFinish';
import './setup.css';
import { IS_WIN } from '../domain/reader';
import { BrandMark } from './avatar';
import { IconBack, IconClose, IconNext, IconPlus, IconRefresh, IconSettings } from './Icons';
import { IconButton } from './kit/IconButton';

/**
 * 설정 화면 = 첫 실행 안내 겸용. 아무것도 안 깔린 맥에서도 여기서 차례로 끝낼 수 있게:
 * ① 언어 ② 환경 점검(없으면 앱 안 터미널로 설치·로그인) ③ 비서 이름·폴더들 ④ 기능 켜기 ⑤ 시작하기(HQ 만들기).
 * 비서 세션은 띄우지 않는다 — 오케스트레이터 홈에서 사람이 만든다(2026-10-03 사용자)
 * 언어·비서 이름은 창이 뜰 때 정하므로 저장하면 창을 다시 연다
 */
type Props = {
  config: Config;
  /** 첫 실행(setupDone 아님) — 닫기 없음, 끝 버튼이 '시작하기' */
  fontSize: number;
  onClose: () => void;
  /** 열자마자 할 일 — 'update' = 점검 단계에서 Claude Code 업데이트를 바로 돌린다(새 버전 알림 띠의 버튼), 'python' = 파이썬 설치(앱 서랍) */
  start?: SetupStart;
  /** 열 때 처음 탭 — 띠의 기기 목록 '기기 연결'은 기기 관리(다른 기기 참모)로, 메신저 로그인은 계정으로 */
  tab?: SettingsTab | 'phone';
};

/** 직접 그린 표시 — 됨(체크)·필요(엑스)·선택(빈 동그라미) */
function Mark({ state }: { state: 'ok' | 'need' | 'opt' }) {
  const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <span className={`su-mark ${state}`} aria-hidden>
      <svg viewBox="0 0 16 16" width="14" height="14" {...P}>
        {state === 'ok' ? <path d="M3.5 8.5l3 3 6-7" /> : state === 'need' ? <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /> : <circle cx="8" cy="8" r="4" />}
      </svg>
    </span>
  );
}

function Row({ state, title, text, children }: { state: 'ok' | 'need' | 'opt'; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="su-row">
      <Mark state={state} />
      <div className="su-row-text"><b>{title}</b><span>{text}</span></div>
      {children && <div className="su-row-act">{children}</div>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="su-field">
      <label>
        <span className="su-label">{label}</span>
        <span className="su-control">{children}</span>
      </label>
      {hint && <div className="su-hint">{hint}</div>}
    </div>
  );
}

const features = (): [FeatureSwitch, string, string][] => [
  ['office', tr('사무실', 'Office'), tr('참모 화면을 픽셀 사무실로 보여 줘요', 'Shows the assistant view as a pixel office')],
  // 문구 소넷 medium(2026-11-02) — 깃 없이도 끝낸 일로 자란다(ADR 0024)
  ['gacha', tr('뽑기', 'Gacha'), tr('끝낸 일로 모은 코인으로 사무실을 꾸며요. git 을 쓰면 커밋·머지도 코인이 돼요.', 'Decorate your office with coins earned from finished tasks. With git on, commits and merges earn coins too.')],
  ['git', tr('코드 프로젝트에 git 쓰기', 'Use git for code projects'), tr('앱·사이트·스크립트 프로젝트에 git(버전 기록)을 켜고, 세션이 커밋·PR 규칙을 따라요. 개발자용이에요. 꺼 두면 폴더에 파일만 남아요. 디자인·문서·영상과 이미 git 이 있는 프로젝트는 그대로예요.', 'Turns on git (version history) for app, site and script projects, and sessions follow commit and PR rules. For developers. When off, files just stay in the folder. Design, document and video projects, and projects that already have git, stay as they are.')],
  ['review', tr('PR 리뷰', 'PR review'), tr('열린 PR 과 머지 전에 볼 것을 모아 보여 줘요 (gh 필요)', 'Collects open PRs and what to check before merging (needs gh)')],
  ['voice', tr('음성 모드', 'Voice mode'), tr('채팅에 음성 모드 단추를 보여 줘요 — 그 단추를 켜면 참모의 답을 소리로 읽어 줘요', "Shows the voice mode button in chat — turn that on to hear the assistant's replies")],
  ['agentView', tr('세션 브라우저 앱에서 보기', 'Watch session browsers in the app'), tr(`세션이 브라우저를 쓰면 그 화면을 대시보드에 띄워요. 켜 둔 동안 이 ${machine()}의 다른 프로그램도 그 크롬을 조종할 수 있어요. 바꾼 설정은 새로 켜는 세션부터 적용돼요`, `Shows what a session's browser is doing on its dashboard. While on, other programs on this ${machine()} could also control that Chrome. Changes apply to sessions started afterwards`)],
  // 맥만 — Claude Code 내장 화면 조종(computer-use)은 맥에서만 준다
  ...(IS_WIN ? [] : [['computerUse', tr('화면 조종 모든 프로젝트', 'Screen control in all projects'), tr('세션이 이 맥 화면을 보고 클릭·입력할 수 있어요(Claude Code computer-use). 모든 프로젝트에 적용돼요. 앱마다 허락을 묻지만, 켜 두면 세션이 화면을 움직일 수 있어요. 끄면 모두 빠져요', 'Lets sessions see, click and type on this Mac\'s screen (Claude Code computer-use), in every project. It asks per app, but while on, sessions can move your screen. Turning it off removes it everywhere')] as [FeatureSwitch, string, string]]),
  ['bubble', tr('떠 있는 참모 배지', 'Floating assistant badge'), tr('앱 밖에도 늘 떠 있는 동그란 참모 얼굴이에요. 누르면 대화창이 열리고, 끌어서 옮겨요', 'One round assistant face floating above every window. Click to chat right there, drag to move it')],
  ['bubbleDesk', tr('앱을 내려도 참모 배지 띄우기', 'Keep the assistant badge when the app is hidden'), tr('앱을 최소화하거나 숨겨도 배지는 바탕 화면에 남아요. 누르면 앱 창 없이 대화창만 열려요', 'Minimize or hide the app and the badge stays on the desktop. Click to chat without bringing the app back')],
  ['autoTidy', tr('세션 자동 정리', 'Tidy sessions automatically'), tr('일이 끝나고 조용한 세션은 참모가 문서를 정리한 뒤 꺼요. 대화는 남아서 다시 켤 수 있어요. 오래 멈춘 목표도 참모가 챙겨요', 'Your assistant tidies up and stops sessions whose work is done and gone quiet. Conversations are kept, so they can be resumed. It also keeps an eye on goals that have stalled')],
  // 익명 사용 신호(Rust usage_ping) — 무엇을 보내고 무엇을 안 보내는지 한 줄(2026-10-24 사용자 '기본 켬 + 끄기 + 알림')
  ['usagePing', tr('익명 사용 통계', 'Anonymous usage statistics'), tr('기능별 횟수와 설치 번호·앱 판·OS 같은 정해 둔 값만 보내요. 대화·파일은 안 보내요', 'Counts and a few fixed values (install ID, app version, OS). Never chats or files')],
  // 기본 참모 앱 다섯(Rust craft_basics → scripts/craft prefetch) — 나머지는 쓸 때 설치(2026-10-26 사용자)
  ['craftBasics', tr('기본 참모 앱 미리 받기', 'Install the basic Chammo apps ahead'), tr('표·PDF·슬라이드·문서·벡터를 미리 깔아 둬요(약 1.5GB). 나머지는 쓸 때 받아요. 남은 공간이 5GB보다 적으면 건너뛰어요', 'Pre-installs Grid, PDF, Slides, Word and Vector in the background (about 1.5 GB). The rest install when you use them. Skipped if under 5 GB is free')],
  ['autoRevive', tr('자동으로 다시 켜기', 'Auto-resume'), tr(`재시작으로 꺼진 세션 중 일이 남은 건 알아서 다시 켜요. 사람이 없는 ${machine()}용이에요`, `Resumes sessions a restart stopped mid-work, on its own. For unattended ${machine()}s`)],
];

const ANIM_CHOICES = (): [Animation, string][] => [['auto', tr('자동', 'Auto')], ['reduce', tr('줄이기', 'Reduce')], ['off', tr('끄기', 'Off')]];
const ANIM_HINT = (): Record<Animation, string> => ({
  auto: tr(`${josa(machine(), "이", "가")} 바쁘면 자동으로 줄여요`, `Reduces on its own when this ${machine()} is busy`),
  reduce: tr('도는 움직임은 멈추고 전환만 짧게', 'Stops looping motion, keeps transitions short'),
  off: tr('움직임 없이 바로 바뀌어요', 'Changes instantly, no motion'),
});

export function Setup({ config, fontSize, onClose, start, tab: tab0 }: Props) {
  const [draft, setDraft] = useState<Config>(config);
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const [check, setCheck] = useState<EnvCheck | null>(null);
  /** git 이름·메일 입력(점검 줄) — 저장된 값이 있으면 그걸로 채운다(win-first M1) */
  const [gitIn, setGitIn] = useState({ name: '', email: '' });
  const [gitErr, setGitErr] = useState<string | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  useEffect(() => {
    if (check?.gitName !== undefined) setGitIn((g) => ({ name: g.name || check.gitName || '', email: g.email || check.gitEmail || '' }));
  }, [check?.gitName, check?.gitEmail]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveGit = async () => {
    const bad = gitIdentityError(gitIn.name, gitIn.email);
    if (bad) { setGitErr(bad === 'name' ? tr('이름을 적어 주세요.', 'Enter a name.') : tr('메일 주소 모양이 아니에요.', 'That does not look like an email address.')); return; }
    setGitBusy(true);
    setGitErr(null);
    try {
      await setGitIdentity(gitIn.name, gitIn.email);
      await recheck();
    } catch (e: unknown) {
      setGitErr(`${tr('저장하지 못했어요.', 'Could not save.')} ${String(e)}`);
    } finally {
      setGitBusy(false);
    }
  };
  const gitIdForm = (
    <>
      <form className="su-control su-inline su-git-id" onSubmit={(e) => { e.preventDefault(); void saveGit(); }}>
        <input value={gitIn.name} placeholder={tr('이름', 'Name')} aria-label={tr('이름', 'Name')} autoComplete="name" spellCheck={false} onChange={(e) => setGitIn((g) => ({ ...g, name: e.target.value }))} />
        <input value={gitIn.email} placeholder={tr('메일', 'Email')} aria-label={tr('메일', 'Email')} type="email" autoComplete="email" spellCheck={false} onChange={(e) => setGitIn((g) => ({ ...g, email: e.target.value }))} />
        <button type="submit" className="btn pri" disabled={gitBusy}>{tr('저장', 'Save')}</button>
      </form>
      {gitErr && <div className="su-error su-git-id">{gitErr}</div>}
    </>
  );
  const [checking, setChecking] = useState(false);
  const [task, setTask] = useState<SetupTask | null>(start ?? null);
  /** 윈도우 git·파이썬 설치를 한 번이라도 돌렸나 — 그 뒤에도 ✕ 면 껐다 켜기 안내 */
  const [tried, setTried] = useState<SetupTask[]>(start ? [start] : []);
  // 윈도우 git·파이썬 — 설치 터미널이 실패로 끝난 것, 사람이 '나중에 하기'로 넘긴 것(회사 PC, win-env H3)
  const [failed, setFailed] = useState<SetupTask[]>([]);
  const [skipped, setSkipped] = useState<SkipKey[]>([]);
  const [dev, setDev] = useState<FolderStatus | null>(null);
  const [hq, setHq] = useState<FolderStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 폴더 믿기 — Claude Code 는 처음 보는 폴더에선 사람이 한 번 믿어 줘야 세션을 띄운다
  const [trust, setTrust] = useState<Trust>({ dev: false, hq: false });
  const [trusting, setTrusting] = useState(false);
  /** 명령줄 도구 없는 맥에서 앱이 받는 도구(ADR 0027) */
  const [tools, setTools] = useState<{ needed: boolean; python: boolean; getter: string } | null>(null);
  const [home, setHome] = useState('');
  // 알림 권한 — 놓치면 결정 대기·답 필요 알림이 안 온다. 시스템 설정에서 켜고 돌아오면 창이 앞으로 올 때 다시 읽는다
  const [notify, setNotify] = useState<NotifyStatus>('unavailable');
  // 브라우저 자동화(선택) — 프로젝트마다 따로 된 로그인 유지 브라우저. '설치' 하나로 Node·크롬 베타·부품·시험 열기 중 없는 것만
  const [browser, setBrowser] = useState<BrowserStatus | null>(null);
  const [browserRun, setBrowserRun] = useState<BrowserSetupState | null>(null);
  const readBrowser = () => void browserStatus().then(setBrowser, () => {});
  const readBrowserRun = () => void browserSetupState().then(setBrowserRun, () => {});
  useEffect(() => {
    readBrowser();
    readBrowserRun(); // 설치 중에 화면을 닫았다 열어도 이어서 보인다
    window.addEventListener('focus', readBrowser);
    return () => window.removeEventListener('focus', readBrowser);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // 도는 동안 0.5초마다 — 끝나면 확인 목록을 다시 읽는다
    if (!browserRun?.running) return;
    const t = setInterval(() => void browserSetupState().then((r) => {
      setBrowserRun(r);
      if (!r.running) readBrowser();
    }, () => {}), 500);
    return () => clearInterval(t);
  }, [browserRun?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const startBrowser = () => void browserSetupStart().then(readBrowserRun, (e: unknown) => setError(String(e)));
  useEffect(() => {
    const read = () => void notifyStatus().then(setNotify, () => {});
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, []);
  // 손쉬운 사용 — Craft 개입·다른 앱 위 말하기 키. 앱은 권한 창을 띄우지 않고, 꺼져 있으면 1초마다 다시 읽어 켜지면 바로 '켜짐'
  const [ax, setAx] = useState<boolean | null>(null);
  const [screen, setScreen] = useState<boolean | null>(null); // 화면 기록 — Craft 앱 창을 칸에 비추기
  useEffect(() => {
    if (IS_WIN) return;
    const read = () => { void axTrusted().then(setAx, () => {}); void screenTrusted().then(setScreen, () => {}); };
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { void getAppEnv().then((e) => setHome(e.home)).catch(() => {}); }, []);
  useEffect(() => { void baseTools().then(setTools, () => {}); }, [check]);
  const abs = (p: string) => p.replace(/^~(?=\/|$)/, home);
  /** 경로는 손으로 치지 않게 — macOS 폴더 고르기 창(입력칸도 그대로 둔다) */
  const choose = async (key: 'devRoot' | 'hqDir' | 'memoDir', prompt: string) => {
    try {
      const got = await pickFolder(prompt, draft[key]);
      if (got) set(key, tildify(got, home));
    } catch (e) { setError(String(e)); }
  };
  const pick = (key: 'devRoot' | 'hqDir' | 'memoDir', prompt: string) => (
    <span className="su-inline">
      <input value={draft[key]} onChange={(e) => set(key, e.target.value)} spellCheck={false} />
      <button type="button" className="btn" onClick={() => void choose(key, prompt)}>{tr('고르기', 'Choose')}</button>
    </span>
  );
  /** 프로젝트 폴더 밖 폴더를 하나씩 — 옮기지 않고 그 자리에서 프로젝트로 본다 */
  const extras = draft.extraProjects ?? [];
  const addExtra = async () => {
    try {
      const got = await pickFolder(tr('프로젝트로 추가할 폴더를 골라 주세요', 'Choose a folder to add as a project'), '~');
      if (!got) return;
      const r = addExtraProject(extras, got, draft.devRoot, home);
      if (r.note === 'inside') setError(tr('프로젝트 폴더 안에 있는 폴더라 이미 보여요.', 'That folder is inside the projects folder, so it already shows up.'));
      else if (r.note === 'root') setError(tr('프로젝트 폴더 자체나 홈 폴더 전체는 추가할 수 없어요. 프로젝트 하나를 골라 주세요.', 'Pick a single project folder, not the projects folder or your whole home folder.'));
      else if (!r.note) set('extraProjects', r.list);
    } catch (e) { setError(String(e)); }
  };
  /** 열어도 되는 폴더 — 홈 밖(D:\Desktop 등)도 참모 도구(show·locker·sheet)·미리보기가 열게. 사람이 여기서만 더한다(공개 이슈 #19) */
  const opens = draft.openFolders ?? [];
  const addOpen = async () => {
    try {
      const got = await pickFolder(tr('참모가 열어도 되는 폴더나 드라이브를 골라 주세요', 'Choose a folder or drive the assistant may open'), '~');
      if (!got) return;
      const r = addOpenFolder(opens, got, home);
      if (r.note === 'holds-home') setError(tr('홈 폴더를 품은 곳(디스크 맨 위·사용자 폴더)은 통째로 열 수 없어요. 그 안의 일 폴더를 골라 주세요.', "You can't open a place that holds your home folder (a disk top or the users folder). Pick a work folder inside it."));
      else if (r.note === 'inside') setError(tr('홈 폴더 안은 이미 열려 있어요.', 'Folders inside your home folder are already open.'));
      else if (!r.note) set('openFolders', r.list);
    } catch (e) { setError(String(e)); }
  };
  // 새 영어 설치는 앱 이름과 다른 기본 이름(Assistant) — 마칠 때 적는다(ux-start M2). 이미 쓰는 사람은 그대로
  const defaultName = tr('참모', 'Chammo');
  const name = draft.assistantName.trim() || defaultName;

  const recheck = useCallback(() => {
    setChecking(true);
    return checkEnv().then((c) => {
      setCheck(c);
      // gh 로 로그인돼 있으면 GitHub 아이디를 채워 둔다(비었을 때만)
      if (c.ghUser) setDraft((d) => (d.githubUser ? d : { ...d, githubUser: c.ghUser! }));
    }).catch((e: unknown) => setError(String(e))).finally(() => setChecking(false));
  }, []);
  useEffect(() => { void recheck(); }, [recheck]);
  // 터미널에서 설치·로그인하는 동안은 5초마다 다시 본다 — 끝나면 줄이 저절로 '됨'으로
  useEffect(() => {
    if (!task) return;
    const t = setInterval(() => void recheck(), 5000);
    return () => clearInterval(t);
  }, [task, recheck]);

  // 폴더 상태 — 글자를 고칠 때마다(잠깐 쉬었다가)
  useEffect(() => {
    const t = setTimeout(() => void folderStatus(draft.devRoot).then(setDev).catch(() => setDev(null)), 250);
    return () => clearTimeout(t);
  }, [draft.devRoot]);
  useEffect(() => {
    const t = setTimeout(() => void folderStatus(draft.hqDir).then(setHq).catch(() => setHq(null)), 250);
    return () => clearTimeout(t);
  }, [draft.hqDir]);
  // 고른 프로젝트 폴더를 실제로 읽어 본다 — 맥이 막으면 세션이 'Unexpected' 로만 실패했다(이슈 #1). 권한 창 답을 기다리는 동안은 2초마다
  const [devAccess, setDevAccess] = useState<Access | null>(null);
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const read = () => void projectAccess(draft.devRoot).then((a) => {
      if (stop) return;
      setDevAccess(a);
      if (a.state === 'pending') t = setTimeout(read, 2000);
    }, () => { if (!stop) setDevAccess(null); });
    t = setTimeout(read, 300);
    const onFocus = () => { clearTimeout(t); read(); }; // 시스템 설정에서 켜고 돌아오면
    window.addEventListener('focus', onFocus);
    return () => { stop = true; clearTimeout(t); window.removeEventListener('focus', onFocus); };
  }, [draft.devRoot]);
  const devBlock = wizardAccess(devAccess).kind;
  const refreshTrust = useCallback(async () => {
    const [d, h] = await Promise.all([claudeTrusted(draft.devRoot).catch(() => false), claudeTrusted(draft.hqDir).catch(() => false)]);
    setTrust({ dev: d, hq: h });
    return { dev: d, hq: h };
  }, [draft.devRoot, draft.hqDir]);
  useEffect(() => {
    const t = setTimeout(() => void refreshTrust(), 300);
    return () => clearTimeout(t);
  }, [refreshTrust]);
  // 믿기 — 터미널 없이 앱이 적는다(trust.rs, ADR 0027). 폴더가 없으면 만들고, 작업 폴더는 틀로 만든다
  const trustNow = async () => {
    setError(null);
    setTrusting(true);
    try {
      await makeDir(draft.devRoot);
      setDev(await folderStatus(draft.devRoot));
      if (!(await folderStatus(draft.hqDir)).hqReady) { await createHq(draft.hqDir, false, [draft.devRoot, ...(draft.extraProjects ?? [])]); setHq(await folderStatus(draft.hqDir)); }
      await trustFolders(draft.devRoot, draft.hqDir);
      await refreshTrust();
    } catch (e: unknown) {
      setError(tr(`폴더를 준비하지 못했어요: ${String(e)}`, `Could not prepare the folder: ${String(e)}`));
    }
    setTrusting(false);
  };

  const pickLanguage = async (l: Lang) => {
    if (l === draft.language) return;
    const next = { ...draft, language: l };
    try {
      await writeConfig(next); // 고르던 값도 같이 — 다시 열어도 그대로
      mirror(next);
      await rebuildMenu().catch(() => {});
      reopen();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const doneLine = tr('끝났어요. 위의 "다시 확인"을 누르거나 잠깐 기다려 주세요.', 'Done. Press "Check again" above, or wait a moment.');
  const run = (t: SetupTask) => { setTried((d) => (d.includes(t) ? d : [...d, t])); setFailed((d) => d.filter((x) => x !== t)); setSkipped((d) => d.filter((x) => x !== t)); setTask(t); };
  const fit = check?.claudeVersion ? versionFit(check.claudeVersion) : 'unknown';
  const ver = parseClaudeVersion(check?.claudeVersion ?? '')?.join('.') ?? check?.claudeVersion;

  const makeHq = async () => {
    setError(null);
    try {
      const r = await createHq(draft.hqDir, false, [draft.devRoot, ...(draft.extraProjects ?? [])]);
      setNote(r.kept.length
        ? tr(`HQ를 만들었어요. 새 파일 ${r.written.length}개, 있던 파일 ${r.kept.length}개는 그대로 뒀어요.`, `HQ is ready. ${r.written.length} new files; ${r.kept.length} existing files were left as they were.`)
        : tr(`HQ 를 만들었어요 — 파일 ${r.written.length}개.`, `HQ is ready — ${r.written.length} files.`));
      setHq(await folderStatus(draft.hqDir));
    } catch (e: unknown) {
      setError(tr(`HQ 만들기 실패: ${String(e)}`, `Could not create the HQ: ${String(e)}`));
    }
  };

  const createDev = async () => {
    setError(null);
    try {
      await makeDir(draft.devRoot);
      setDev(await folderStatus(draft.devRoot));
    } catch (e: unknown) {
      setError(tr(`폴더 만들기 실패: ${String(e)}`, `Could not create the folder: ${String(e)}`));
    }
  };

  /** 시작하기(첫 실행) / 저장(설정) */
  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = { ...draft, setupDone: true };
      await writeConfig(next);
      mirror(next);
      await rebuildMenu().catch(() => {}); // 메뉴가 옛 글자로 남아도 다음에 켜면 바뀐다
      reopen();
    } catch (e: unknown) {
      setError(tr(`저장하지 못했어요: ${String(e)}`, `Could not save: ${String(e)}`));
      setBusy(false);
    }
  };

  // 윈도우 설치·업데이트 터미널 안내 줄 — 'Claude 다시 설치' 카드와 같은 묶음(domain/setup winSetupNotes)
  const winNotes = winSetupNotes();
  const claudeRow = !check ? null : check.claudePath ? (
    fit === 'old' ? (
      <Row state="need" title="Claude Code" text={tr(`설치돼 있지만 옛 버전이에요(${ver}). 2.1.280 이상이 필요해요. 누르면 아래 터미널에서 최신으로 올려요.`, `Installed, but old (${ver}). Chammo needs 2.1.280 or later. The button updates it to the latest in the terminal below.`)}>
        <button className="btn pri" onClick={() => run('update')}>{tr('업데이트', 'Update')}</button>
      </Row>
    ) : (
      <Row state="ok" title="Claude Code" text={check.claudeRestored
        ? tr(`업데이트가 중간에 끊겨서 이전 판으로 되돌렸어요 (${ver || check.claudePath}).`, `The update was cut off, so the previous version was restored (${ver || check.claudePath}).`)
        : tr(`설치돼 있어요 (${ver || check.claudePath}).`, `Installed (${ver || check.claudePath}).`)} />
    )
  ) : (
    <Row state="need" title="Claude Code" text={tr('아직 없어요. 버튼을 누르면 아래 터미널에서 공식 설치 스크립트를 돌려요. 망에 따라 몇 분 이상 걸릴 수 있어요.', 'Not installed yet. The button runs the official install script in the terminal below. It can take several minutes or more depending on your network.')}>
      <button className="btn pri" onClick={() => run('install')}>{tr('설치하기', 'Install')}</button>
    </Row>
  );

  const langSeg = (
          <div className="su-seg" role="radiogroup" aria-label={tr('언어', 'Language')}>
            {(['ko', 'en'] as Lang[]).map((l) => (
              <button key={l} role="radio" aria-checked={draft.language === l} className={draft.language === l ? 'on' : ''} onClick={() => void pickLanguage(l)}>
                {l === 'ko' ? '한국어' : 'English'}
              </button>
            ))}
          </div>
  );
  // 윈도우 git·파이썬 줄 — 설치 실패·winget 없음·찾기 실패를 갈라 말하고, 받기 링크·나중에 하기(회사 PC)를 준다(win-env H3)
  const winToolRow = (t: 'clt' | 'python', ok: boolean) => {
    const title = t === 'clt' ? 'git' : tr('파이썬 3', 'Python 3');
    if (ok) return <Row state="ok" title={title} text={tr('있어요.', 'Installed.')} />;
    const install = <button className="btn pri" onClick={() => run(t)}>{tr('설치하기', 'Install')}</button>;
    if (skipped.includes(t)) return (
      <Row state="opt" title={title} text={t === 'clt'
        ? tr('git 없이 다음으로 넘어가요. 세션이 저장소나 커밋 같은 git이 필요한 일에서 멈출 수 있어요. 나중에 설정에서 다시 설치할 수 있어요.', 'Continuing without git. Sessions may get stuck on tasks that need it, like repositories and commits. You can install it later in Settings.')
        : tr('파이썬 없이 다음으로 넘어가요. 참모 도구(작업 기록·예약)와 Craft 앱을 쓸 수 없어요. 나중에 설정에서 다시 설치할 수 있어요.', "Continuing without Python. Chammo's tools (task records, schedules) and the Craft apps won't work. You can install it later in Settings.")}>{install}</Row>
    );
    const st = installState({ win: true, tried: tried.includes(t), running: task === t, ok, failed: failed.includes(t), winget: check?.winget });
    const get = <button className="btn" onClick={() => void openTarget('url', GET_URL[t]).catch(() => {})}>{tr('받기', 'Get')}</button>;
    const skip = <button className="btn" onClick={() => setSkipped((d) => [...d, t])}>{tr('나중에 하기', 'Skip for now')}</button>;
    const name = t === 'clt' ? 'git' : tr('파이썬', 'Python');
    const text = st === 'noWinget'
      ? (t === 'clt'
        ? tr("이 PC에는 winget이 없어서 git을 자동으로 설치할 수 없어요. '받기'를 눌러 git 공식 사이트에서 직접 설치한 뒤, '다시 확인'을 눌러 주세요.", 'This PC doesn\'t have winget, so git can\'t be installed automatically. Press "Get" to download it from the official git site, install it, then press "Check again".')
        : tr("이 PC에는 winget이 없어서 파이썬을 자동으로 설치할 수 없어요. '받기'를 눌러 파이썬 공식 사이트에서 직접 설치한 뒤, '다시 확인'을 눌러 주세요.", 'This PC doesn\'t have winget, so Python can\'t be installed automatically. Press "Get" to download it from the official Python site, install it, then press "Check again".'))
      : st === 'failed'
        ? tr(`${name} 설치가 끝나지 않았어요(취소했거나 관리자 권한이 없을 수 있어요). 아래 터미널 내용을 확인해 주세요. 관리자 권한이 없으면 '받기'로 공식 사이트에서 '나만 쓰기(이 사용자만)'를 골라 설치할 수 있어요.`, `${name} installation didn't finish (it may have been canceled, or you may lack admin rights). Check the terminal below. Without admin rights, press "Get" and choose "Install just for me" (this user only) on the official site.`)
        : st === 'notFound'
          ? (t === 'clt' ? tr('git은 있는데 Chammo가 못 찾아요. Chammo를 완전히 껐다 켜 주세요.', 'git is installed but Chammo can\'t find it. Quit Chammo completely and open it again.') : tr('파이썬은 있는데 Chammo가 못 찾아요. Chammo를 완전히 껐다 켜 주세요.', 'Python is installed but Chammo can\'t find it. Quit Chammo completely and open it again.'))
          : (t === 'clt' ? tr('git 이 필요해요. 누르면 winget 으로 설치해요 — 몇 분 걸려요.', 'git is required. The button installs it with winget — it takes a few minutes.') : tr('참모 도구와 앱에 파이썬 3이 필요해요. 누르면 winget으로 설치해요. 몇 분 걸려요.', 'Python 3 is required by the assistant tools and Chammo apps. The button installs it with winget. It takes a few minutes.'));
    return <Row state="need" title={title} text={text}>{st !== 'noWinget' && install}{st !== 'need' && get}{st !== 'need' && skip}</Row>;
  };
  const recheckBtn = <button className="btn" disabled={checking} onClick={() => void recheck()}>{checking ? tr('확인하는 중…', 'Checking…') : tr('다시 확인', 'Check again')}</button>;
  const checkBody = (
        <>
          {!check ? <div className="su-hint">{tr('필요한 도구가 있는지 보고 있어요…', 'Looking for the tools Chammo needs…')}</div> : (
            <div className="su-rows">
              {claudeRow}
              {check.claudePath && (loginRow(check) === 'ok'
                ? <Row state="ok" title={tr('Claude 로그인', 'Claude sign-in')} text={claudeSignedInText()} />
                : loginRow(check) === 'unknown'
                  ? <Row state="need" title={tr('Claude 로그인', 'Claude sign-in')} text={tr("로그인 여부를 확인하지 못했어요. PC가 느리거나 바쁜 것 같아요 — 로그인이 풀린 건 아닐 수 있으니, 위의 '다시 확인'을 눌러 주세요.", 'Couldn\'t check your sign-in. Your PC may be slow or busy, so you might still be signed in. Press "Check again" above.')} />
                  : <Row state="need" title={tr('Claude 로그인', 'Claude sign-in')} text={tr('로그인이 필요해요. 버튼을 누르면 브라우저가 열려요 — 로그인하고 돌아오면 돼요.', 'You need to sign in. The button opens your browser — sign in and come back.')}>
                      <button className="btn pri" onClick={() => run('login')}>{tr('로그인하기', 'Sign in')}</button>
                    </Row>)}
              {IS_WIN ? winToolRow('clt', check.clt) : check.clt
                ? <Row state="ok" title="Git" text={tr('설치돼 있어요.', 'Installed.')} />
                : <Row state="opt" title="Git" text={tr('처음 쓸 때 받아요. 지금 받아도 돼요', 'Downloads on first use. Get it now if you like')}>
                    <button className="btn" onClick={() => run('clt')}>{tr('받기', 'Get')}</button>
                  </Row>}
              {!IS_WIN && tools?.needed && (tools.python && check.python !== false
                ? <Row state="ok" title={tr('참모 도구', 'Assistant tools')} text={tr('받았어요', 'Downloaded')} />
                : <Row state="need" title={tr('참모 도구', 'Assistant tools')} text={tr('필요해요. 누르면 받아요', 'Needed. Click to download')}>
                    <button className="btn pri" onClick={() => run('python')}>{tr('받기', 'Get')}</button>
                  </Row>)}
              {IS_WIN && winToolRow('python', check.python !== false)}
              {gitIdentityRow(check, draft.features.git) === 'ok' && <Row state="ok" title={tr('git 이름·메일', 'Git name and email')} text={`${check.gitName} · ${check.gitEmail}`} />}
              {gitIdentityRow(check, draft.features.git) === 'need' && (
                <>
                  {skipped.includes('gitId')
                    ? <Row state="opt" title={tr('git 이름·메일', 'Git name and email')} text={tr('이름·메일 없이 다음으로 넘어가요. 그동안 세션이 커밋을 남겨야 하는 일에서 멈추거나, 커밋 없이 끝날 수 있어요. 아래 칸에 지금 적어도 되고, 나중에 설정 > 도구 점검에서 적을 수도 있어요.', 'Continuing without a git name and email. Sessions may get stuck on tasks that need commits, or finish without one. You can still fill them in below, or later in Settings > Tools.')} />
                    : <Row state="need" title={tr('git 이름·메일', 'Git name and email')} text={tr('프로젝트마다 저장 기록(커밋)에 남길 이름과 메일이 필요해요. 이 컴퓨터에 한 번만 적으면 돼요. 공개 저장소에 올리면 다른 사람도 볼 수 있어요.', 'Each project needs a name and email to record with its commits. You only enter them once on this computer. Anyone can see them if you push to a public repository.')}>
                        {/* 회사 PC 처럼 지금 못 정하면 넘긴다 — 첫 설정을 막지 않게(0.4.7 2차 검증) */}
                        <button className="btn" onClick={() => setSkipped((d) => [...d, 'gitId'])}>{tr('나중에 하기', 'Skip for now')}</button>
                      </Row>}
                  {gitIdForm}
                </>
              )}
              {ghRow(check) === 'ok'
                ? <Row state="ok" title={tr('GitHub CLI (선택)', 'GitHub CLI (optional)')} text={tr(`${check.ghUser} 로 로그인돼 있어요.`, `Signed in as ${check.ghUser}.`)} />
                : ghRow(check) !== 'install'
                  ? <Row state="opt" title={tr('GitHub CLI (선택)', 'GitHub CLI (optional)')} text={ghRow(check) === 'relogin' ? tr('로그인이 풀렸어요. 다시 로그인해 주세요. PR 리뷰에만 필요해요.', 'The sign-in expired. Sign in again. Only needed for PR review.') : tr('설치돼 있지만 로그인 전이에요. PR 리뷰에만 필요해요.', 'Installed but not signed in. Only needed for PR review.')}>
                      <button className="btn" onClick={() => run('ghLogin')}>{ghRow(check) === 'relogin' ? tr('다시 로그인', 'Sign in again') : tr('로그인하기', 'Sign in')}</button>
                    </Row>
                  : <Row state="opt" title={tr('GitHub CLI (선택)', 'GitHub CLI (optional)')} text={tr('선택 — PR 리뷰에만 필요해요. 없어도 나머지는 다 돼요.', 'Optional — only needed for PR review. Everything else works without it.')}>
                      <button className="btn" onClick={() => void openTarget('url', 'https://cli.github.com').catch(() => {})}>{tr('설치 안내 열기', 'Open install guide')}</button>
                    </Row>}
            </div>
          )}
          {task && (
            <div className="su-term">
              <TerminalPane
                key={task}
                autoFocus
                command={setupCommand(task, { claude: check?.claudePath, gh: check?.ghPath, getter: tools?.getter }, doneLine, undefined, undefined, winNotes)}
                title={task === 'install' ? tr('Claude Code 설치', 'Installing Claude Code') : task === 'update' ? tr('Claude Code 업데이트', 'Updating Claude Code') : task === 'login' ? tr('Claude 로그인', 'Claude sign-in') : task === 'clt' ? tr('git 설치', 'Installing git') : task === 'python' ? tr('파이썬 3 설치', 'Installing Python 3') : tr('GitHub 로그인', 'GitHub sign-in')}
                subtitle={tr('이 창에 바로 입력할 수 있어요', 'You can type in this window')}
                fontSize={fontSize}
                controls={<IconButton label={tr('닫기', 'Close')} onClick={() => { setTask(null); void recheck(); }}><IconClose /></IconButton>}
                onExit={(screen) => { if (setupFailed(screen)) setFailed((d) => (d.includes(task) ? d : [...d, task])); }}
              />
            </div>
          )}
        </>
  );
  // 아래 조각들을 첫 실행 안내(단계)와 설정 모달(탭)이 따로 묶는다 — 안내 순서는 예전 그대로
  const nameField = (
          <Field label={tr('참모 이름', 'Assistant name')} hint={tr('세션 목록·알림에 이 이름으로 보여요.', 'Shown in the session list and notifications.')}>
            <input value={draft.assistantName} placeholder={defaultName} onChange={(e) => set('assistantName', e.target.value)} />
          </Field>
  );
  const devField = (
          <Field label={tr('프로젝트 폴더', 'Projects folder')} hint={devBlock
            ? devBlock === 'mac'
              ? <>{tr('맥이 이 폴더 접근을 막고 있어요. 전체 디스크 접근 권한에서 Chammo 를 켠 뒤 앱을 다시 켜 주세요.', 'macOS is blocking this folder. Turn on Chammo in Full Disk Access, then reopen the app.')} <IconButton tone="line" className="su-inline" label={tr('설정 열기', 'Open Settings')} title={tr('맥 설정 열기 — 전체 디스크 접근', 'Open macOS Settings — Full Disk Access')} onClick={() => void openTarget('url', FULL_DISK_URL).catch(() => {})}><IconSettings /></IconButton></>
              : devBlock === 'perm'
                ? tr('이 폴더를 읽을 권한이 없어요. 다른 폴더를 고르거나 폴더 권한을 고쳐 주세요.', 'No permission to read this folder. Pick another folder or fix its permissions.')
                : tr('맥이 이 폴더에 들어가도 되는지 묻고 있어요. 뜬 창에서 허용을 눌러 주세요.', 'macOS is asking whether Chammo may open this folder. Click Allow in that window.')
            : dev && !dev.exists
            ? <>{tr('아직 없는 폴더예요.', 'This folder does not exist yet.')} <button type="button" className="btn su-mini" onClick={() => void createDev()}>{tr(`${draft.devRoot} 만들기`, `Create ${draft.devRoot}`)}</button></>
            : tr('프로젝트(git 저장소)들이 들어 있는 폴더. 그 안의 폴더 하나가 프로젝트 하나예요.', 'The folder that holds your projects (git repos). Each folder inside is one project.')}>
            {pick('devRoot', tr('프로젝트들이 들어 있는 폴더를 골라 주세요', 'Choose the folder that holds your projects'))}
          </Field>
  );
  const extrasField = (
          /* label 로 감싸지 않는다 — 라벨 글자를 누르면 안의 첫 버튼(첫 폴더 빼기)이 눌린다 */
          <div className="su-field su-field-list">
            <div className="su-list-row">
              <span className="su-label">{tr('따로 둔 프로젝트', 'Other projects')}</span>
              <span className="su-extras">
                {extras.map((p) => (
                  <span className="su-extra" key={p}>
                    <code>{p}</code>
                    <IconButton tone="line" label={tr('빼기', 'Remove')} onClick={() => set('extraProjects', extras.filter((x) => x !== p))}><IconClose /></IconButton>
                  </span>
                ))}
                <IconButton size="l" tone="line" label={tr('폴더 추가', 'Add folder')} onClick={() => void addExtra()}><IconPlus /></IconButton>
              </span>
            </div>
            <div className="su-hint">{tr('프로젝트 폴더 밖에 있는 폴더도 하나씩 추가할 수 있어요. 옮기지 않고 그 자리에서 프로젝트로 보여요.', 'Add folders that live outside the projects folder, one by one. They stay where they are and show up as projects.')}</div>
          </div>
  );
  const opensField = (
          <div className="su-field su-field-list">
            <div className="su-list-row">
              <span className="su-label">{tr('열어도 되는 폴더', 'Folders it may open')}</span>
              <span className="su-extras">
                {opens.map((p) => (
                  <span className="su-extra" key={p}>
                    <code>{p}</code>
                    <IconButton tone="line" label={tr('빼기', 'Remove')} onClick={() => set('openFolders', opens.filter((x) => x !== p))}><IconClose /></IconButton>
                  </span>
                ))}
                <IconButton size="l" tone="line" label={tr('폴더 추가', 'Add folder')} onClick={() => void addOpen()}><IconPlus /></IconButton>
              </span>
            </div>
            <div className="su-hint">{tr(`홈 폴더 밖(D: 드라이브 등)에서 ${name}가 파일을 열고 엑셀을 읽을 수 있는 폴더예요. 채팅에 붙인 파일은 여기 없어도 사본으로 들어가요.`, `Folders outside your home folder (another drive, for example) where ${name} may open files and read spreadsheets. Files you attach in chat don't need to be here — they go in as a copy.`)}</div>
          </div>
  );
  const hqField = (
          <Field label={tr('참모 작업 폴더', 'Assistant workspace folder')} hint={hq?.hqReady
            ? tr(`준비됐어요. ${name}가 여기서 일해요.`, `Ready. ${name} works from here.`)
            : <>{tr(`${name}가 일하는 폴더예요. 안내문(CLAUDE.md)과 도구(scripts)를 넣어 만들어요.`, `The folder ${name} works from. It gets a guide (CLAUDE.md) and tools (scripts).`)} <button type="button" className="btn su-mini" onClick={() => void makeHq()}>{tr('HQ 만들기', 'Create HQ')}</button></>}>
            {pick('hqDir', tr('HQ로 쓸 폴더를 골라 주세요. 새 폴더를 만들어도 돼요', 'Choose a folder for HQ. You can make a new one here'))}
          </Field>
  );
  const githubField = (
          <Field label={tr('GitHub 아이디', 'GitHub username')} hint={tr('CI 코인과 PR 리뷰에 써요. 비워 둬도 돼요.', 'Used for CI coins and PR review. You can leave it empty.')}>
            <input value={draft.githubUser} onChange={(e) => set('githubUser', e.target.value)} spellCheck={false} />
          </Field>
  );
  const ttsField = <TtsField value={draft.ttsCommand} onChange={(c) => set('ttsCommand', c)} name={name} onError={setError} />;
  const talkField = (
          /* 말하기 키는 맥 전용(ptt.rs 가 macOS 이벤트 탭) — 윈도우판은 아직 없다 */
          !IS_WIN && <Field label={tr('말하기 키', 'Talk key')}
            hint={draft.talkKey === 'fn'
              ? <>{tr('누르고 말하면 입력칸에 받아 적어요. 다른 키와 같이 누르면(fn+화살표 등) 말하기로 안 봐요. 맥 설정의 "🌐 키를 누르면"은 "아무것도 안 함"으로 두세요. 한/영 전환·받아쓰기와 겹쳐요.', 'Hold and speak to dictate into the session input. Pressing it with another key (fn+arrows, etc.) doesn\'t count. Set macOS "Press 🌐 key to" to "Do Nothing". Otherwise it clashes with input switching and dictation.')} <IconButton tone="line" className="su-inline" label={tr('키보드 설정 열기', 'Open Keyboard settings')} onClick={() => void openTarget('url', 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension').catch(() => {})}><IconSettings /></IconButton></>
              : draft.talkKey === 'right-option'
                ? tr('오른쪽 ⌥ 를 누르고 말하면 세션 입력칸에 받아 적어요. 다른 키와 같이 누르면 말하기로 안 봐요.', 'Hold right ⌥ and speak to dictate into the session input. Pressing it with another key doesn\'t count.')
                : tr('키를 누르고 말하면 세션 입력칸에 받아 적는 기능이에요. 꺼 두면 아무 키도 가로채지 않아요.', 'Hold a key and speak to dictate into the session input. Off means no key is watched.')}>
            <span className="su-seg" role="radiogroup" aria-label={tr('말하기 키', 'Talk key')}>
              {([['', tr('끔', 'Off')], ['fn', tr('지구본(fn)', 'Globe (fn)')], ['right-option', tr('오른쪽 ⌥', 'Right ⌥')]] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={(draft.talkKey ?? '') === v} className={(draft.talkKey ?? '') === v ? 'on' : ''} onClick={() => set('talkKey', v)}>{label}</button>
              ))}
            </span>
            {draft.talkKey ? (
              <>
                {/* 권한은 쓸 때 묻는다(ADR 0027) — 켜는 순간 맥 목록에 올리고, 꺼져 있으면 그 자리에 한 줄 */}
                <label className="su-check"><input type="checkbox" checked={!!draft.talkAnywhere} onChange={(e) => { set('talkAnywhere', e.target.checked); if (e.target.checked && ax === false) void askPermission('ax').catch(() => {}); }} />
                  {tr('다른 앱을 보고 있을 때도', 'Also while using other apps')}</label>
                {draft.talkAnywhere && ax === false && (
                  <span className="su-inline su-hint">{tr('시스템 설정 > 손쉬운 사용에서 Chammo를 켜 주세요', 'Turn on Chammo in System Settings > Accessibility')} <IconButton tone="line" className="su-inline" label={tr('설정 열기', 'Open Settings')} title={tr('맥 설정 열기 — 손쉬운 사용', 'Open macOS Settings — Accessibility')} onClick={() => void askPermission('ax').catch(() => {})}><IconSettings /></IconButton></span>
                )}
              </>
            ) : null}
          </Field>
  );
  // 브라우저 칸 주소창에 주소가 아닌 글을 치면 찾는 곳(2026-10-28)
  const searchField = (
          <Field label={tr('기본 검색', 'Default search')} hint={tr('브라우저 칸 주소창에 주소가 아닌 글을 치면 여기서 찾아요.', 'What the browser pane’s address bar searches when you type something that isn’t an address.')}>
            <span className="su-seg" role="radiogroup" aria-label={tr('기본 검색', 'Default search')}>
              {([['', tr('구글', 'Google')], ['naver', tr('네이버', 'Naver')]] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={(draft.searchEngine ?? '') === v} className={(draft.searchEngine ?? '') === v ? 'on' : ''} onClick={() => set('searchEngine', v)}>{label}</button>
              ))}
            </span>
          </Field>
  );
  const memoField = (
          <Field label={tr('메모 폴더', 'Notes folder')} hint={tr('프로젝트별 메모(⌘M)가 저장되는 곳.', 'Where per-project notes (⌘M) are saved.')}>
            {pick('memoDir', tr('메모를 저장할 폴더를 골라 주세요', 'Choose where notes are saved'))}
          </Field>
  );
  const trustBlock = (
          <div className="su-rows su-trust">
            <Row state={trust.dev && trust.hq ? 'ok' : 'need'} title={tr('이 폴더에서 일하기', 'Work in these folders')}
              text={trust.dev && trust.hq ? tr('믿는 폴더예요.', 'Trusted.') : tr('프로젝트 폴더와 참모 작업 폴더를 믿으면 세션이 여기서 일해요.', 'Trust the projects and assistant workspace folders so sessions can work here.')}>
              {!(trust.dev && trust.hq) && <button className="btn pri" disabled={trusting} onClick={() => void trustNow()}>{tr('믿기', 'Trust')}</button>}
            </Row>
          </div>
  );
  const notifyBlock = (() => {
            const n = notifyRow(notify);
            return (
              <div className="su-rows">
                <Row state={n.state} title={tr('알림', 'Notifications')}
                  text={n.state === 'ok' ? tr('켜져 있어요. 결정이 필요하거나 답을 기다리면 알려 드려요.', 'On. You get told when a decision or an answer is needed.')
                    : n.action === 'settings' ? (IS_WIN
                      ? tr('꺼져 있어요. 윈도우 설정 > 시스템 > 알림에서 알림을 켜 주세요 — 안 켜면 결정 대기·답 필요 알림이 안 와요.', 'Off. Turn notifications on in Windows Settings > System > Notifications — otherwise you miss decision and answer alerts.')
                      : tr('꺼져 있어요. 시스템 설정 > 알림 > Chammo 에서 "알림 허용"을 켜 주세요 — 안 켜면 결정 대기·답 필요 알림이 안 와요.', 'Off. Turn on "Allow notifications" in System Settings > Notifications > Chammo — otherwise you miss decision and answer alerts.'))
                    : n.action === 'request' ? tr('결정이 필요하거나 답을 기다릴 때 알려 드려요. 버튼을 누르면 macOS 가 한 번 물어봐요.', 'Get told when a decision or an answer is needed. The button makes macOS ask once.')
                    : tr('이 빌드에서는 확인할 수 없어요.', 'Cannot be checked in this build.')}>
                  {n.action === 'request' && <button className="btn pri" onClick={() => void notifyRequest().then(() => notifyStatus()).then(setNotify, () => {})}>{tr('알림 허용', 'Allow')}</button>}
                  {n.action === 'settings' && <IconButton size="l" tone="line" label={tr('설정 열기', 'Open Settings')} title={tr('맥 알림 설정 열기', 'Open macOS notification settings')} onClick={() => void notifyOpenSettings()}><IconSettings /></IconButton>}
                </Row>
              </div>
            );
          })();
  const axBlock = IS_WIN || ax === null ? null : (() => {
            const a = axRow(ax);
            return (
              <div className="su-rows">
                <Row state={a.state} title={tr('손쉬운 사용', 'Accessibility')}
                  text={a.state === 'ok' ? tr('켜져 있어요. Craft 앱에 직접 손대기(개입)와 다른 앱 위 말하기 키가 돼요.', 'On. Taking over a Craft app and the talk key over other apps work.')
                    : tr('꺼져 있어요. 시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용에서 Chammo를 켜 주세요. Craft 앱을 직접 만지려면 필요해요. 나중에 해도 돼요.', 'Off. Turn on Chammo in System Settings > Privacy & Security > Accessibility. It\'s needed to take over a Craft app. You can do this later.')}>
                  {a.action === 'settings' && <IconButton size="l" tone="line" label={tr('설정 열기', 'Open Settings')} title={tr('맥 설정 열기 — 손쉬운 사용', 'Open macOS Settings — Accessibility')} onClick={() => void askPermission('ax').catch(() => {})}><IconSettings /></IconButton>}
                </Row>
              </div>
            );
          })();
  const screenBlock = IS_WIN || screen === null ? null : (() => {
            const a = axRow(screen);
            return (
              <div className="su-rows">
                <Row state={a.state} title={tr('화면 기록', 'Screen Recording')}
                  text={a.state === 'ok' ? tr('켜져 있어요. Craft 앱 창을 칸에 비춰 보여 줘요.', 'On. Craft app windows show in their pane.')
                    : tr('꺼져 있어요. 시스템 설정 > 개인정보 보호 및 보안 > 화면 및 시스템 오디오 녹음에서 Chammo를 켜고 앱을 다시 켜 주세요. Craft 앱 작업을 칸에서 보려면 필요해요. 그 앱 창만 찍어요.', 'Off. Turn on Chammo in System Settings > Privacy & Security > Screen & System Audio Recording, then restart Chammo. It\'s needed to watch Craft apps in their pane. Only that app window is captured.')}>
                  {a.action === 'settings' && <IconButton size="l" tone="line" label={tr('설정 열기', 'Open Settings')} title={tr('맥 설정 열기 — 화면 기록', 'Open macOS Settings — Screen Recording')} onClick={() => void askPermission('screen').catch(() => {})}><IconSettings /></IconButton>}
                </Row>
              </div>
            );
          })();
  const browserBlock = (() => {
            const b = browserRow(browser, browserRun);
            const label: Record<string, string> = { node: 'Node.js', chrome: tr('크롬 베타', 'Chrome Beta'), parts: tr('도구 부품', 'Tool parts'), check: tr('시험 열기', 'Test open') };
            return (
              <div className="su-rows">
                <Row state={b.state} title={tr('참모 브라우저', 'Assistant browser')}
                  text={b.state === 'ok' ? tr('설치됐어요', 'Installed')
                    : browser ? tr('세션이 웹사이트를 여는 브라우저예요. 없는 것만 받고 암호는 안 물어요', 'Sessions use it to open websites. Only missing parts download; no password')
                    : tr('확인하는 중…', 'Checking…')}>
                  {b.action && (b.action === 'retry'
                    ? <IconButton size="l" tone="pri" label={tr('다시 시도', 'Try again')} onClick={startBrowser}><IconRefresh /></IconButton>
                    : <button className="btn pri" onClick={startBrowser}>{tr('설치', 'Install')}</button>)}
                </Row>
                {browser && (
                  <ul className="su-checks">
                    {browserChecklist(browser, browserRun).map((c) => (
                      <li key={c.key} className={`st-${c.state}`}>
                        <span className="su-dot" aria-hidden />{label[c.key]}
                        {c.key === 'node' && browser.nodeOk && <small>{browser.nodeVersion}</small>}
                      </li>
                    ))}
                  </ul>
                )}
                {b.busy && browserRun && (
                  <div className="su-progress" role="status">
                    <div className={`su-bar${browserRun.pct == null ? ' flow' : ''}`}><i style={{ width: `${browserRun.pct ?? 100}%` }} /></div>
                    <span>{browserRun.text}</span>
                  </div>
                )}
                {!b.busy && browserRun?.error && <div className="su-hint su-err">{browserRun.error}</div>}
                {!b.busy && browserRun?.done && browserRun.note && <div className="su-hint">{browserRun.note}</div>}
              </div>
            );
          })();
  // git 을 켰는데 이름·메일이 비면 스위치 바로 아래에 칸(첫 설정 점검 단계보다 기능 단계가 뒤라 거기선 못 물었다 — 시안 git-optional)
  const gitIdBelow = draft.features.git && check && gitIdentityRow(check, true) === 'need' && (
    <div className="cfg-git-id">
      <span className="su-hint">{tr('커밋에 남는 이름과 메일이에요. 공개 저장소에 올리면 다른 사람도 볼 수 있어요.', 'This name and email are saved with each commit. Anyone can see them if you publish to a public repository.')}</span>
      {gitIdForm}
    </div>
  );
  const switches = (keys: FeatureSwitch[]) => (
    <div className="cfg-rows">
      {features().filter(([k]) => keys.includes(k)).map(([k, label, text]) => (
        <Fragment key={k}>
          <label className="cfg-row">
            <span className="cfg-rt"><b>{label}</b><span>{text}</span></span>
            <input type="checkbox" role="switch" className="cfg-sw" checked={draft.features[k]} onChange={(e) => set('features', { ...draft.features, [k]: e.target.checked })} />
          </label>
          {k === 'git' && gitIdBelow}
        </Fragment>
      ))}
    </div>
  );
  const featGrid = (
          <div className="su-feats">
            {features().map(([k, label, text]) => (
              <label key={k} className="su-feat">
                <input type="checkbox" checked={draft.features[k]} onChange={(e) => set('features', { ...draft.features, [k]: e.target.checked })} />
                <span><b>{label}</b><span>{text}</span></span>
              </label>
            ))}
          </div>
  );
  const animField = (
          /* 2026-10-12 사용자 "부하 심하면 애니메이션 때문에 끊긴다" — 자동은 OS 동작 줄이기·맥 부하가 높을 때 저절로 줄인다(domain/animCalm) */
          <Field label={tr('애니메이션', 'Animation')} hint={ANIM_HINT()[draft.features.animation ?? 'auto']}>
            <span className="su-seg" role="radiogroup" aria-label={tr('애니메이션', 'Animation')}>
              {ANIM_CHOICES().map(([v, label]) => {
                const on = (draft.features.animation ?? 'auto') === v;
                return <button key={v} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => set('features', { ...draft.features, animation: v })}>{label}</button>;
              })}
            </span>
          </Field>
  );
  // ---- 설정(첫 실행 아님) = 앱 창 안 모달 + 왼쪽 탭. 지금 탭만 그린다 — 안 보는 탭의 읽기(목소리 목록 등)가 열 때 안 돈다 ----
  const [tab, setTab] = useState<SettingsTab>(tabOf(tab0) ?? firstTab(start)); // 옛 이름 phone 도 기기 관리로
  const [ver0, setVer0] = useState('');
  useEffect(() => { void appVersion().then(setVer0, () => {}); }, []);
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => { modal.current?.focus(); }, []); // 뒤 채팅 입력칸에 글이 안 가게
  useEffect(() => {
    // capture — 채팅 칸의 'Esc = 참모 멈추기'보다 먼저 받아 거기로 안 새게
    const key = (e: KeyboardEvent) => {
      const inTerminal = e.target instanceof Element && !!e.target.closest('.xterm');
      if (!settingsEscCloses({ key: e.key, composing: e.isComposing, inTerminal })) return;
      e.preventDefault(); e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const langField = (
    <div className="su-field">
      <div className="su-line"><span className="su-label">{tr('언어', 'Language')}</span><span className="su-control">{langSeg}</span></div>
    </div>
  );
  const TAB_LABEL: Record<SettingsTab, string> = {
    general: tr('일반', 'General'), agent: name, features: tr('기능', 'Features'), voice: tr('알림과 음성', 'Alerts & voice'),
    devices: tr('기기 관리', 'Devices'), messenger: tr('메신저', 'Messenger'), accounts: tr('계정', 'Accounts'), browser: tr('브라우저', 'Browser'), tools: tr('도구 점검', 'Tools'),
  };
  const tabBody: Record<SettingsTab, ReactNode> = {
    general: <>{langField}{memoField}{draft.features.git && githubField}{searchField}</>,
    agent: <>{nameField}{hqField}{devField}{extrasField}{opensField}{trustBlock}{switches(['autoRevive'])}</>,
    // PR 리뷰는 git 을 쓸 때만(ADR 0024)
    features: <>{axBlock}{screenBlock}{switches(['office', 'gacha', 'git', ...(draft.features.git ? ['review' as const] : []), 'bubble', 'bubbleDesk', 'autoTidy', 'craftBasics', 'usagePing'])}{animField}</>,
    voice: <>{notifyBlock}{switches(['voice'])}{ttsField}{talkField}</>,
    devices: <DevicesSection title={tr('내 기기', 'My devices')} onAccount={() => setTab('accounts')} fallback={<><MobileSection title={tr('폰', 'Phone')} onAccount={() => setTab('accounts')} /><PeerSection title={tr('다른 기기 참모', 'Chammo on other devices')} /></>} />,
    messenger: <><TeamSoundSection title={tr('메신저 알림', 'Messenger alerts')} /><MessengerSection title={tr('텔레그램', 'Telegram')} /></>,
    // Chammo 계정이 맨 위 — 폰 중계·내 기기·메신저가 다 이 계정에 걸린다. Claude 계정 바꿔 끼우기는 맥 = 키체인, 윈도우 = 로그인 파일 + 자격 증명 관리자
    accounts: (<><TeamAccountSection title={tr('Chammo 계정', 'Chammo account')} onDevices={() => setTab('devices')} /><AccountsSection title={tr('Claude 계정', 'Claude accounts')} claude={check?.claudePath} fontSize={fontSize} /></>),
    browser: <>{browserBlock}{switches(['agentView', 'computerUse'])}</>,
    tools: <><div className="cfg-tools-head"><span className="su-hint">{tr(`Chammo 가 쓰는 도구가 이 ${machine()}에 있는지`, `Whether the tools Chammo uses are on this ${machine()}`)}</span>{recheckBtn}</div>{checkBody}</>,
  };
  return (
    <div className="setup cfg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cfg-modal" role="dialog" aria-modal="true" aria-label={tr('설정', 'Settings')} ref={modal} tabIndex={-1} style={{ '--cfg-tint': BRAND.color } as CSSProperties}>
        <nav className="cfg-side" role="tablist" aria-orientation="vertical" aria-label={tr('설정 메뉴', 'Settings menu')}>
          <div className="cfg-me"><BrandMark size={34} /><div><b>{tr('설정', 'Settings')}</b><span>Chammo{ver0 ? ` · v${ver0}` : ''}</span></div></div>
          {settingsTabs(IS_WIN).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`cfg-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
          ))}
        </nav>
        <div className="cfg-card" role="tabpanel" aria-label={TAB_LABEL[tab]}>
          <header className="cfg-head">
            <h2>{TAB_LABEL[tab]}</h2>
            <IconButton size="l" label={tr('닫기', 'Close')} title={tr('닫기 (Esc)', 'Close (Esc)')} onClick={onClose}><IconClose /></IconButton>
          </header>
          <div className="cfg-body" key={tab}>{tabBody[tab]}</div>
          <footer className="cfg-foot">
            {note && <div className="su-note">{note}</div>}
            {error && <div className="su-error">{error}</div>}
            <div className="cfg-foot-row">
              {/* 언어(일반)·참모 이름(참모 탭)이 사는 탭에서만 — 모든 탭에 같은 줄이 붙어 글만 늘었다(QA 30) */}
              <span>{tab === 'general' ? tr('언어는 저장하면 창을 다시 열며 바뀌어요', 'Language applies as the window reopens') : tab === 'agent' ? tr('참모 이름은 저장하면 창을 다시 열며 바뀌어요', 'The assistant name applies as the window reopens') : null}</span>
              <button className="btn" disabled={busy} onClick={onClose}>{tr('취소', 'Cancel')}</button>
              <button className="btn pri su-go" disabled={busy} onClick={() => void finish()}>{busy ? tr('저장하는 중…', 'Saving…') : tr('저장', 'Save')}</button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

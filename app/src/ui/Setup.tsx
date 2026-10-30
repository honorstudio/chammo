import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TtsField } from './TtsField';
import { appVersion, browserSetupStart, browserSetupState, browserStatus, checkEnv, claudeTrusted, projectAccess, notifyOpenSettings, notifyRequest, notifyStatus, axTrusted, screenTrusted, askPermission, createHq, folderStatus, getAppEnv, makeDir, openTarget, pickFolder, rebuildMenu, writeConfig, type Config, type FolderStatus } from '../data/tauri';
import { addExtraProject, canNext, nextWhy, trustExitNote, parseClaudeVersion, setupCommand, setupReady, tildify, notifyRow, axRow, browserRow, browserChecklist, ghRow, gitStillMissing, versionFit, WIZARD, type BrowserSetupState, type BrowserStatus, type EnvCheck, type NotifyStatus, type SetupTask, type Trust, type WizardStep } from '../domain/setup';
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
  firstRun: boolean;
  fontSize: number;
  onClose: () => void;
  /** 열자마자 할 일 — 'update' = 점검 단계에서 Claude Code 업데이트를 바로 돌린다(새 버전 알림 띠의 버튼), 'python' = 파이썬 설치(앱 서랍) */
  start?: SetupStart;
  /** 열 때 처음 탭 — 띠의 기기 목록 '기기 연결'은 기기 관리(다른 기기 참모)로, 메신저 로그인은 계정으로 */
  tab?: SettingsTab | 'phone';
};

const reopen = () => {
  try { sessionStorage.removeItem('mirrorReloaded'); } catch { /* 없어도 된다 */ }
  location.reload();
};

/** 언어·비서 이름을 main.tsx 가 다음에 뜰 때 읽는 자리에 */
function mirror(c: Config) {
  try {
    if (c.language === 'ko' || c.language === 'en') localStorage.setItem('lang', c.language);
    if (c.assistantName.trim()) localStorage.setItem('assistantName', c.assistantName.trim());
    else localStorage.removeItem('assistantName');
  } catch { /* 저장소가 막혀도 설정 파일이 있으니 다음에 App 이 다시 비춘다 */ }
}

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
  ['tama', tr('다마고치', 'Tamagotchi'), tr('커밋·머지를 먹고 자라는 작은 펫 위젯', 'A small pet widget that grows on your commits and merges')],
  ['gacha', tr('뽑기', 'Gacha'), tr('머지·커밋으로 모은 코인으로 사무실 꾸미기', 'Decorate the office with coins earned from merges and commits')],
  ['review', tr('PR 리뷰', 'PR review'), tr('열린 PR 과 머지 전에 볼 것을 모아 보여 줘요 (gh 필요)', 'Collects open PRs and what to check before merging (needs gh)')],
  ['voice', tr('음성 모드', 'Voice mode'), tr('채팅에 음성 모드 단추를 보여 줘요 — 그 단추를 켜면 참모의 답을 소리로 읽어 줘요', "Shows the voice mode button in chat — turn that on to hear the assistant's replies")],
  ['agentView', tr('세션 브라우저 앱에서 보기', 'Watch session browsers in the app'), tr(`세션이 브라우저를 쓰면 그 화면을 대시보드에 띄워요. 켜 둔 동안 이 ${machine()}의 다른 프로그램도 그 크롬을 조종할 수 있어요. 바꾼 설정은 새로 켜는 세션부터 적용돼요`, `Shows what a session's browser is doing on its dashboard. While on, other programs on this ${machine()} could also control that Chrome. Changes apply to sessions started afterwards`)],
  // 맥만 — Claude Code 내장 화면 조종(computer-use)은 맥에서만 준다
  ...(IS_WIN ? [] : [['computerUse', tr('화면 조종 모든 프로젝트', 'Screen control in all projects'), tr('세션이 이 맥 화면을 보고 클릭·입력할 수 있어요(Claude Code computer-use). 모든 프로젝트에 적용돼요. 앱마다 허락을 묻지만, 켜 두면 세션이 화면을 움직일 수 있어요. 끄면 모두 빠져요', 'Lets sessions see, click and type on this Mac\'s screen (Claude Code computer-use), in every project. It asks per app, but while on, sessions can move your screen. Turning it off removes it everywhere')] as [FeatureSwitch, string, string]]),
  ['bubble', tr('떠 있는 참모 배지', 'Floating assistant badge'), tr('앱 밖에도 늘 떠 있는 동그란 참모 얼굴이에요. 누르면 대화창이 열리고, 끌어서 옮겨요', 'One round assistant face floating above every window. Click to chat right there, drag to move it')],
  ['bubbleDesk', tr('앱을 내려도 참모 배지 띄우기', 'Keep the assistant badge when the app is hidden'), tr('앱을 최소화하거나 숨겨도 배지는 바탕 화면에 남아요. 누르면 앱 창 없이 대화창만 열려요', 'Minimize or hide the app and the badge stays on the desktop. Click to chat without bringing the app back')],
  ['autoTidy', tr('세션 자동 정리', 'Tidy sessions automatically'), tr('일이 끝나고 조용한 세션은 참모가 문서를 정리한 뒤 꺼요. 대화는 남아서 다시 켤 수 있어요. 오래 멈춘 목표도 참모가 챙겨요', 'Your assistant tidies up and stops sessions whose work is done and gone quiet. Conversations are kept, so they can be resumed. It also keeps an eye on goals that have stalled')],
  // 익명 사용 신호(Rust usage_ping) — 무엇을 보내고 무엇을 안 보내는지 한 줄(2026-10-24 사용자 '기본 켬 + 끄기 + 알림')
  ['usagePing', tr('익명 사용 통계', 'Anonymous usage statistics'), tr('몇 대가 어떤 기능을 얼마나 쓰는지 개수만 보내요. 대화·파일은 안 보내요', 'Counts only — how many installs use which features. Never chats or files')],
  // 기본 참모 앱 다섯(Rust craft_basics → scripts/craft prefetch) — 나머지는 쓸 때 설치(2026-10-26 사용자)
  ['craftBasics', tr('기본 참모 앱 미리 받기', 'Install the basic Chammo apps ahead'), tr('표·PDF·슬라이드·문서·벡터를 미리 깔아 둬요(약 1.5GB). 나머지는 쓸 때 받아요. 남은 공간이 5GB보다 적으면 건너뛰어요', 'Pre-installs Grid, PDF, Slides, Word and Vector in the background (about 1.5 GB). The rest install when you use them. Skipped if under 5 GB is free')],
  ['autoRevive', tr('자동으로 다시 켜기', 'Auto-resume'), tr(`재시작으로 꺼진 세션 중 일이 남은 건 알아서 다시 켜요. 사람이 없는 ${machine()}용이에요`, `Resumes sessions a restart stopped mid-work, on its own. For unattended ${machine()}s`)],
];

const ANIM_CHOICES = (): [Animation, string][] => [['auto', tr('자동', 'Auto')], ['reduce', tr('줄이기', 'Reduce')], ['off', tr('끄기', 'Off')]];
const ANIM_HINT = (): Record<Animation, string> => ({
  auto: tr(`${josa(machine(), "이", "가")} 바쁘면 저절로 줄여요`, `Reduces on its own when this ${machine()} is busy`),
  reduce: tr('도는 움직임은 멈추고 전환만 짧게', 'Stops looping motion, keeps transitions short'),
  off: tr('움직임 없이 바로 바뀌어요', 'Changes instantly, no motion'),
});

export function Setup({ config, firstRun, fontSize, onClose, start, tab: tab0 }: Props) {
  const [draft, setDraft] = useState<Config>(config);
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const [check, setCheck] = useState<EnvCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [task, setTask] = useState<SetupTask | null>(start ?? null);
  /** 윈도우 git·파이썬 설치를 한 번이라도 돌렸나 — 그 뒤에도 ✕ 면 껐다 켜기 안내 */
  const [tried, setTried] = useState<SetupTask[]>(start ? [start] : []);
  const [dev, setDev] = useState<FolderStatus | null>(null);
  const [hq, setHq] = useState<FolderStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 폴더 믿기 — Claude Code 는 처음 보는 폴더에선 사람이 한 번 믿어 줘야 세션을 띄운다
  const [trust, setTrust] = useState<Trust>({ dev: false, hq: false });
  const [trusting, setTrusting] = useState<'dev' | 'hq' | null>(null);
  // 믿기 터미널은 절대 경로로 cd 한다(따옴표 안의 ~·$HOME 은 안 풀린다)
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
  // 믿기 창이 열려 있는 동안 2초마다 — 기록되면 창을 닫는다(claude 도 같이 꺼진다)
  useEffect(() => {
    if (!trusting) return;
    const t = setInterval(() => void refreshTrust().then((r) => { if (r[trusting]) setTrusting(null); }), 2000);
    return () => clearInterval(t);
  }, [trusting, refreshTrust]);
  // 믿기 터미널의 claude 가 끝났다 — 믿었으면 위 2초 확인이 닫고, 아니면(Enter 만 쳐서 No) 닫고 다시 하라고(2026-10-21 첫 사용자 QA)
  const trustExit = (screen: string) => void refreshTrust().then((r) => setTrusting((w) => { if (w && !r[w]) { setError(trustExitNote(screen)); return null; } return w; }));
  const startTrust = async (which: 'dev' | 'hq') => {
    setError(null);
    try {
      // 믿으려면 폴더가 있어야 한다 — 프로젝트 폴더는 만들고, HQ 는 템플릿으로 만든다
      if (which === 'dev') { await makeDir(draft.devRoot); setDev(await folderStatus(draft.devRoot)); }
      else if (!(await folderStatus(draft.hqDir)).hqReady) { await createHq(draft.hqDir, false, [draft.devRoot, ...(draft.extraProjects ?? [])]); setHq(await folderStatus(draft.hqDir)); }
      setTask(null);
      setTrusting(which);
    } catch (e: unknown) {
      setError(tr(`폴더를 준비하지 못했어요: ${String(e)}`, `Could not prepare the folder: ${String(e)}`));
    }
  };

  // 첫 실행에 기본 프로젝트 폴더가 하나도 없으면 ~/Projects 를 권한다(만들기 버튼이 뜬다)
  useEffect(() => {
    if (!firstRun) return;
    void folderStatus(config.devRoot).then((s) => { if (!s.exists) setDraft((d) => (d.devRoot === config.devRoot ? { ...d, devRoot: '~/Projects' } : d)); }).catch(() => {});
  }, [firstRun, config.devRoot]);

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
  const run = (t: SetupTask) => { setTried((d) => (d.includes(t) ? d : [...d, t])); setTask(t); };
  const ready = setupReady(check);
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
      if (firstRun) {
        await makeDir(draft.devRoot);
        if (!(await folderStatus(draft.hqDir)).hqReady) await createHq(draft.hqDir, false, [draft.devRoot, ...(draft.extraProjects ?? [])]);
      }
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

  // 윈도우 winget 업데이트 터미널에 찍는 두 줄 — {0} = 돌고 있는 claude 수
  const winNotes = {
    busy: tr('Claude 가 {0}개 돌고 있어요(세션). 업데이트는 하지만 그 세션들은 다시 켜기 전까지 옛 버전이에요.', 'Claude is running ({0}, your sessions). Updating anyway — those sessions keep the old version until restarted.'),
    back: tr('업데이트 실패, 이전 판으로 되돌렸어요.', 'Update failed — restored the previous version.'),
  };
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
    <Row state="need" title="Claude Code" text={tr('아직 없어요. 버튼을 누르면 아래 터미널에서 공식 설치 스크립트를 돌려요. 1~2분이면 끝나요.', 'Not installed yet. The button runs the official install script in the terminal below — it takes a minute or two.')}>
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
  const langSec = (
        <section className="su-sec">
          <h2>{tr('언어', 'Language')}</h2>
          {langSeg}
        </section>
  );
  const recheckBtn = <button className="btn" disabled={checking} onClick={() => void recheck()}>{checking ? tr('확인하는 중…', 'Checking…') : tr('다시 확인', 'Check again')}</button>;
  const checkBody = (
        <>
          {!check ? <div className="su-hint">{tr('필요한 도구가 있는지 보고 있어요…', 'Looking for the tools Chammo needs…')}</div> : (
            <div className="su-rows">
              {claudeRow}
              {check.claudePath && (check.loggedIn
                ? <Row state="ok" title={tr('Claude 로그인', 'Claude sign-in')} text={tr('로그인돼 있어요. Chammo 는 이 로그인을 그대로 써요.', 'Signed in. Chammo uses this sign-in as is.')} />
                : <Row state="need" title={tr('Claude 로그인', 'Claude sign-in')} text={tr('로그인이 필요해요. 버튼을 누르면 브라우저가 열려요 — 로그인하고 돌아오면 돼요.', 'You need to sign in. The button opens your browser — sign in and come back.')}>
                    <button className="btn pri" onClick={() => run('login')}>{tr('로그인하기', 'Sign in')}</button>
                  </Row>)}
              {check.clt
                ? <Row state="ok" title={IS_WIN ? 'git' : tr('git (Xcode 명령줄 도구)', 'git (Xcode Command Line Tools)')} text={tr('있어요.', 'Installed.')} />
                : <Row state="need" title={IS_WIN ? 'git' : tr('git (Xcode 명령줄 도구)', 'git (Xcode Command Line Tools)')} text={IS_WIN ? (gitStillMissing({ win: IS_WIN, tried: tried.includes('clt'), running: task === 'clt', ok: check.clt })
                    ? tr('git은 있는데 Chammo가 못 찾아요. Chammo를 완전히 껐다 켜 주세요.', 'git is installed but Chammo can\'t find it. Quit Chammo completely and open it again.')
                    : tr('git 이 필요해요. 누르면 winget 으로 설치해요 — 몇 분 걸려요.', 'git is required. The button installs it with winget — it takes a few minutes.')) : tr('git 이 들어 있는 Apple 도구예요. 누르면 macOS 설치 창이 떠요 — 설치에 몇 분 걸려요.', "Apple's tools that include git. The button opens the macOS installer — it takes a few minutes.")}>
                    <button className="btn pri" onClick={() => run('clt')}>{tr('설치하기', 'Install')}</button>
                  </Row>}
              {IS_WIN && (check.python !== false
                ? <Row state="ok" title={tr('파이썬 3', 'Python 3')} text={tr('있어요.', 'Installed.')} />
                : <Row state="need" title={tr('파이썬 3', 'Python 3')} text={gitStillMissing({ win: IS_WIN, tried: tried.includes('python'), running: task === 'python', ok: false })
                    ? tr('파이썬은 있는데 Chammo가 못 찾아요. Chammo를 완전히 껐다 켜 주세요.', 'Python is installed but Chammo can\'t find it. Quit Chammo completely and open it again.')
                    : tr('참모 도구와 앱에 파이썬 3이 필요해요. 누르면 winget으로 설치해요. 몇 분 걸려요.', 'Python 3 is required by the assistant tools and Chammo apps. The button installs it with winget. It takes a few minutes.')}>
                    <button className="btn pri" onClick={() => run('python')}>{tr('설치하기', 'Install')}</button>
                  </Row>)}
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
                command={setupCommand(task, { claude: check?.claudePath, gh: check?.ghPath }, doneLine, undefined, undefined, winNotes)}
                title={task === 'install' ? tr('Claude Code 설치', 'Installing Claude Code') : task === 'update' ? tr('Claude Code 업데이트', 'Updating Claude Code') : task === 'login' ? tr('Claude 로그인', 'Claude sign-in') : task === 'clt' ? tr('명령줄 도구 설치', 'Installing Command Line Tools') : task === 'python' ? tr('파이썬 3 설치', 'Installing Python 3') : tr('GitHub 로그인', 'GitHub sign-in')}
                subtitle={tr('이 창에 바로 입력할 수 있어요', 'You can type in this window')}
                fontSize={fontSize}
                controls={<IconButton label={tr('닫기', 'Close')} onClick={() => { setTask(null); void recheck(); }}><IconClose /></IconButton>}
              />
            </div>
          )}
        </>
  );
  const checkSec = (
        <section className="su-sec">
          <div className="su-sec-head">
            <h2>{tr(`이 ${machine()} 점검`, `Check this ${machine()}`)}</h2>
            {recheckBtn}
          </div>
          {checkBody}
        </section>
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
  const hqField = (
          <Field label={tr('HQ 폴더', 'HQ folder')} hint={hq?.hqReady
            ? tr(`준비됐어요. ${name}가 여기서 일해요.`, `Ready. ${name} works from here.`)
            : <>{tr(`${name}가 일하는 폴더예요. 안내문(CLAUDE.md)과 도구(scripts)를 넣어 만들어요.`, `The folder ${name} works from. It gets a guide (CLAUDE.md) and tools (scripts).`)} <button type="button" className="btn su-mini" onClick={() => void makeHq()}>{tr('HQ 만들기', 'Create HQ')}</button></>}>
            {pick('hqDir', tr('HQ로 쓸 폴더를 골라 주세요. 새 폴더를 만들어도 돼요', 'Choose a folder for HQ. You can make a new one here'))}
          </Field>
  );
  const githubField = (
          <Field label={tr('GitHub 아이디', 'GitHub username')} hint={tr('다마고치 CI 배틀과 PR 리뷰에 써요. 비워 둬도 돼요.', 'Used for the Tamagotchi CI battle and PR review. You can leave it empty.')}>
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
              <label className="su-check"><input type="checkbox" checked={!!draft.talkAnywhere} onChange={(e) => set('talkAnywhere', e.target.checked)} />
                {tr('다른 앱을 보고 있을 때도(설정 > 기능의 손쉬운 사용을 켜야 해요)', 'Also while using other apps (needs Accessibility on — Settings > Features)')}</label>
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
            <div className="su-hint">{tr('Claude Code는 처음 보는 폴더에서 일하기 전에 "이 폴더를 믿나요?"를 한 번 물어요. 폴더 두 개를 한 번씩 믿어 주세요. 프로젝트 폴더를 믿으면 안의 프로젝트는 다시 안 물어요.', 'Before working in a new folder, Claude Code asks once whether you trust it. Trust these two folders once. Trusting the projects folder covers every project inside it.')}</div>
            {(['dev', 'hq'] as const).map((w) => (
              <Row key={w} state={trust[w] ? 'ok' : 'need'} title={w === 'dev' ? tr('프로젝트 폴더 믿기', 'Trust the projects folder') : tr('HQ 폴더 믿기', 'Trust the HQ folder')}
                text={trust[w] ? tr('믿는 폴더예요.', 'Trusted.') : tr('누르면 아래에 터미널이 열려요. 질문이 나오면 ↓로 "Yes, I trust this folder"를 골라 Enter. 창은 저절로 닫혀요.', 'The button opens a terminal below. When asked, press ↓ to pick "Yes, I trust this folder", then Enter. The window closes by itself.')}>
                {!trust[w] && <button className="btn pri" disabled={!!trusting} onClick={() => void startTrust(w)}>{tr('믿기', 'Trust')}</button>}
              </Row>
            ))}
            {trusting && (
              <div className="su-term">
                <TerminalPane
                  key={`trust-${trusting}`}
                  autoFocus
                  onExit={trustExit}
                  command={setupCommand('trust', { claude: check?.claudePath }, '', abs(trusting === 'dev' ? draft.devRoot : draft.hqDir))}
                  title={tr('폴더 믿기', 'Trust folder')}
                  subtitle={tr('↓ 로 Yes 고르고 Enter', '↓ to Yes, then Enter')}
                  fontSize={fontSize}
                  controls={<IconButton label={tr('닫기', 'Close')} onClick={() => { setTrusting(null); void refreshTrust(); }}><IconClose /></IconButton>}
                />
              </div>
            )}
          </div>
  );
  const basicsSec = (
        <section className="su-sec">
          <h2>{tr('기본 설정', 'Basics')}</h2>
          {nameField}{devField}{extrasField}{hqField}{githubField}{ttsField}{talkField}{memoField}{trustBlock}
        </section>
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
                <Row state={b.state} title={tr('브라우저 자동화 (선택)', 'Browser automation (optional)')}
                  text={b.state === 'ok' ? tr('준비됐어요. 프로젝트마다 로그인이 유지되는 브라우저를 따로 줘요.', 'Ready. Each project gets its own browser that stays logged in.')
                    : browser ? tr('세션이 웹사이트를 열고 확인하게 해요. 없는 것만 받아요 — 관리자 암호는 안 물어요.', 'Lets sessions open and check websites. Only what is missing is downloaded — no admin password.')
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
  const featSec = (
        <section className="su-sec">
          <h2>{tr('기능', 'Features')}</h2>
          <p className="su-hint">{tr('꺼 두면 그 버튼과 메뉴가 숨어요. 언제든 여기서 다시 켤 수 있어요.', 'Turned-off features hide their buttons and menus. You can turn them back on here any time.')}</p>
          {notifyBlock}{axBlock}{screenBlock}{browserBlock}{featGrid}{animField}
        </section>
  );
  // 마지막 단계 — 고른 것 한눈에
  const readySec = (
        <section className="su-sec">
          <h2>{tr('준비 끝', 'All set')}</h2>
          {/* HQ 는 3단계 '믿기'에서 이미 만들어졌으면 또 만든다고 하지 않는다(윈도우 QA 31), 예는 '새로 만들어 줘' 꼴 — 새 프로젝트 폴더는 비어 있다(QA 11) */}
          <p className="su-hint">{hq?.hqReady
            ? tr(`시작하기를 누르면 첫 화면이 떠요. '새 ${name} 만들기'를 눌러 말을 걸어 보세요. 예: "할 일 목록 웹페이지 하나 만들어 줘"`, `Press Get started for the first screen. Press 'Create a new ${name}' and talk to it. For example: "make me a simple to-do list web page"`)
            : tr(`시작하기를 누르면 HQ 폴더를 만들어요. 첫 화면에서 '새 ${name} 만들기'를 눌러 말을 걸어 보세요. 예: "할 일 목록 웹페이지 하나 만들어 줘"`, `Press Get started to create the HQ folder. On the first screen, press 'Create a new ${name}' and talk to it. For example: "make me a simple to-do list web page"`)}</p>
          <p className="su-hint">{tr(`${name}와 세션은 확인 없이 명령을 실행해요. 처음 띄울 때 한 번 동의를 받아요.`, `${name} and its sessions run commands without asking. You will be asked to agree once when the first one starts.`)}</p>
          {/* 첫 실행 한 줄 알림 — 이 단계를 지나야(setupDone) 사용 신호가 나간다(usage_ping.rs) */}
          {draft.features.usagePing && <p className="su-hint">{tr('하루 한 번 익명 사용 통계를 보내요. 어떤 기능을 몇 대가 쓰는지 개수만 보내고, 대화·파일은 안 보내요. 설정 > 기능에서 끌 수 있어요.', 'Once a day Chammo sends anonymous usage statistics: counts only, never chats or files. Turn it off in Settings > Features.')}</p>}
          <dl className="su-sum">
            <dt>{tr('참모 이름', 'Assistant')}</dt><dd>{name}</dd>
            <dt>{tr('프로젝트 폴더', 'Projects')}</dt><dd>{draft.devRoot}</dd>
            <dt>{tr('HQ 폴더', 'HQ')}</dt><dd>{draft.hqDir}</dd>
            <dt>{tr('음성', 'Speech')}</dt><dd>{IS_WIN && /^(say( -v \S+)?)?$/.test(draft.ttsCommand.trim()) ? tr('Windows 목소리', 'Windows voice') : draft.ttsCommand || 'say'}</dd>
          </dl>
        </section>
  );
  const [step, setStep] = useState<WizardStep>(start ? 'check' : 'welcome');
  const at = WIZARD.indexOf(step);
  // 단계의 알림 줄('HQ 를 만들었어요')은 그 단계에서만 — 4·5단계까지 따라왔다(윈도우 QA 31)
  useEffect(() => { setNote(null); }, [step]);
  const sectionOf: Record<WizardStep, ReactNode> = { welcome: langSec, check: checkSec, basics: basicsSec, features: featSec, ready: readySec };

  // ---- 설정(첫 실행 아님) = 앱 창 안 모달 + 왼쪽 탭. 지금 탭만 그린다 — 안 보는 탭의 읽기(목소리 목록 등)가 열 때 안 돈다 ----
  const [tab, setTab] = useState<SettingsTab>(tabOf(tab0) ?? firstTab(start)); // 옛 이름 phone 도 기기 관리로
  const [ver0, setVer0] = useState('');
  useEffect(() => { if (!firstRun) void appVersion().then(setVer0, () => {}); }, [firstRun]);
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => { modal.current?.focus(); }, []); // 뒤 채팅 입력칸에 글이 안 가게
  useEffect(() => {
    if (firstRun) return;
    // capture — 채팅 칸의 'Esc = 참모 멈추기'보다 먼저 받아 거기로 안 새게
    const key = (e: KeyboardEvent) => {
      const inTerminal = e.target instanceof Element && !!e.target.closest('.xterm');
      if (!settingsEscCloses({ key: e.key, composing: e.isComposing, inTerminal })) return;
      e.preventDefault(); e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [firstRun, onClose]);
  const langField = (
    <div className="su-field">
      <div className="su-line"><span className="su-label">{tr('언어', 'Language')}</span><span className="su-control">{langSeg}</span></div>
    </div>
  );
  const switches = (keys: FeatureSwitch[]) => (
    <div className="cfg-rows">
      {features().filter(([k]) => keys.includes(k)).map(([k, label, text]) => (
        <label key={k} className="cfg-row">
          <span className="cfg-rt"><b>{label}</b><span>{text}</span></span>
          <input type="checkbox" role="switch" className="cfg-sw" checked={draft.features[k]} onChange={(e) => set('features', { ...draft.features, [k]: e.target.checked })} />
        </label>
      ))}
    </div>
  );
  const TAB_LABEL: Record<SettingsTab, string> = {
    general: tr('일반', 'General'), agent: name, features: tr('기능', 'Features'), voice: tr('알림과 음성', 'Alerts & voice'),
    devices: tr('기기 관리', 'Devices'), messenger: tr('메신저', 'Messenger'), accounts: tr('계정', 'Accounts'), browser: tr('브라우저', 'Browser'), tools: tr('도구 점검', 'Tools'),
  };
  const tabBody: Record<SettingsTab, ReactNode> = {
    general: <>{langField}{memoField}{githubField}{searchField}</>,
    agent: <>{nameField}{hqField}{devField}{extrasField}{trustBlock}{switches(['autoRevive'])}</>,
    features: <>{axBlock}{screenBlock}{switches(['office', 'tama', 'gacha', 'review', 'bubble', 'bubbleDesk', 'autoTidy', 'craftBasics', 'usagePing'])}{animField}</>,
    voice: <>{notifyBlock}{switches(['voice'])}{ttsField}{talkField}</>,
    devices: <DevicesSection title={tr('내 기기', 'My devices')} onAccount={() => setTab('accounts')} fallback={<><MobileSection title={tr('폰', 'Phone')} onAccount={() => setTab('accounts')} /><PeerSection title={tr('다른 기기 참모', 'Chammo on other devices')} /></>} />,
    messenger: <><TeamSoundSection title={tr('메신저 알림', 'Messenger alerts')} /><MessengerSection title={tr('텔레그램', 'Telegram')} /></>,
    // Chammo 계정이 맨 위 — 폰 중계·내 기기·메신저가 다 이 계정에 걸린다. Claude 계정 바꿔 끼우기는 맥 = 키체인, 윈도우 = 로그인 파일 + 자격 증명 관리자
    accounts: (<><TeamAccountSection title={tr('Chammo 계정', 'Chammo account')} onDevices={() => setTab('devices')} /><AccountsSection title={tr('Claude 계정', 'Claude accounts')} claude={check?.claudePath} fontSize={fontSize} /></>),
    browser: <>{browserBlock}{switches(['agentView', 'computerUse'])}</>,
    tools: <><div className="cfg-tools-head"><span className="su-hint">{tr(`Chammo 가 쓰는 도구가 이 ${machine()}에 있는지`, `Whether the tools Chammo uses are on this ${machine()}`)}</span>{recheckBtn}</div>{checkBody}</>,
  };
  if (!firstRun) return (
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

  // 첫 실행 안내 — 창 전체 한 장, 다섯 단계
  return (
    <div className="setup" role="dialog" aria-modal="true" aria-label={tr('설정', 'Settings')}>
      <div className="setup-page">
        <header className="su-head">
          <div>
            <BrandMark size={64} className="su-brand" />
            <h1>{tr('Chammo 에 오신 걸 환영해요', 'Welcome to Chammo')}</h1>
            <p>{step === 'welcome' ? tr('Chammo 는 Claude Code 세션들을 굴리는 참모예요. 결정은 당신이, 일은 참모가. 다섯 단계면 끝나요.', 'Chammo is a chief of staff that runs your Claude Code sessions. You make the calls; it runs the team. Five short steps and you are in.') : tr(`${at + 1} / ${WIZARD.length} 단계`, `Step ${at + 1} of ${WIZARD.length}`)}</p>
          </div>
        </header>
        <ol className="su-steps" aria-label={tr('진행', 'Progress')}>
          {WIZARD.map((w, i) => <li key={w} className={i < at ? 'done' : i === at ? 'on' : ''} />)}
        </ol>

        {sectionOf[step]}

        <footer className="su-foot">
          {note && <div className="su-note">{note}</div>}
          {error && <div className="su-error">{error}</div>}
          {/* 다음이 꺼진 까닭은 단추 바로 위에 — 점검 단계는 점검 결과가 온 뒤에만 */}
          {(step !== 'check' || check) && nextWhy(step, check, trust, devAccess, IS_WIN) && <div className="su-hint">{nextWhy(step, check, trust, devAccess, IS_WIN)}</div>}
          <div className="su-nav">
            {at > 0 && <IconButton size="l" tone="line" className="su-nav-ib" label={tr('뒤로', 'Back')} disabled={busy} onClick={() => setStep(WIZARD[at - 1]!)}><IconBack /></IconButton>}
            <span className="grow" />
            {step === 'ready'
              ? <button className="btn pri su-go" disabled={busy || !ready} onClick={() => void finish()}>{busy ? tr('준비하는 중…', 'Getting ready…') : tr('시작하기', 'Get started')}</button>
              : <IconButton size="l" tone="pri" className="su-nav-ib" label={tr('다음', 'Next')} disabled={!canNext(step, check, trust, devAccess)} onClick={() => setStep(WIZARD[at + 1]!)}><IconNext /></IconButton>}
          </div>
        </footer>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { browserInstallCommand, browserStatus, checkEnv, claudeTrusted, notifyOpenSettings, notifyRequest, notifyStatus, createHq, folderStatus, getAppEnv, makeDir, openTarget, pickFolder, rebuildMenu, spawnSession, ttsTest, writeConfig, type Config, type FolderStatus } from '../data/tauri';
import { addExtraProject, canNext, parseClaudeVersion, setupCommand, setupReady, tildify, notifyRow, browserRow, versionFit, WIZARD, type BrowserStatus, type EnvCheck, type NotifyStatus, type SetupTask, type Trust, type WizardStep } from '../domain/setup';
import { nextOrchestratorName } from '../domain/session';
import type { Features } from '../domain/config';
import { setAssistant, tr, type Lang } from '../i18n';
import { TerminalPane } from './TerminalPane';
import './setup.css';

/**
 * 설정 화면 = 첫 실행 안내 겸용. 아무것도 안 깔린 맥에서도 여기서 차례로 끝낼 수 있게:
 * ① 언어 ② 환경 점검(없으면 앱 안 터미널로 설치·로그인) ③ 비서 이름·폴더들 ④ 기능 켜기 ⑤ 시작하기(HQ 만들고 비서 세션 띄우기)
 * 언어·비서 이름은 창이 뜰 때 정하므로 저장하면 창을 다시 연다
 */
type Props = {
  config: Config;
  /** 첫 실행(setupDone 아님) — 닫기 없음, 끝 버튼이 '시작하기'이고 비서 세션을 띄운다 */
  firstRun: boolean;
  /** 지금 떠 있는 비서 세션 이름들 — 이미 있으면 또 띄우지 않는다 */
  orchestratorNames: string[];
  fontSize: number;
  onClose: () => void;
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

const features = (): [keyof Features, string, string][] => [
  ['office', tr('사무실', 'Office'), tr('비서 화면을 픽셀 사무실로 보여 줘요', 'Shows the assistant view as a pixel office')],
  ['tama', tr('다마고치', 'Tamagotchi'), tr('커밋·머지를 먹고 자라는 작은 펫 위젯', 'A small pet widget that grows on your commits and merges')],
  ['gacha', tr('뽑기', 'Gacha'), tr('머지·커밋으로 모은 코인으로 사무실 꾸미기', 'Decorate the office with coins earned from merges and commits')],
  ['review', tr('PR 리뷰', 'PR review'), tr('열린 PR 과 머지 전에 볼 것을 모아 보여 줘요 (gh 필요)', 'Collects open PRs and what to check before merging (needs gh)')],
  ['voice', tr('음성 모드', 'Voice mode'), tr('비서의 답을 소리로 읽어 줘요', "Reads the assistant's replies aloud")],
];

export function Setup({ config, firstRun, orchestratorNames, fontSize, onClose }: Props) {
  const [draft, setDraft] = useState<Config>(config);
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const [check, setCheck] = useState<EnvCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [task, setTask] = useState<SetupTask | null>(null);
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
  // 브라우저 자동화(선택) — 프로젝트마다 따로 된 로그인 유지 브라우저. Node 20+ 가 있어야 깐다
  const [browser, setBrowser] = useState<BrowserStatus | null>(null);
  const [browserCmd, setBrowserCmd] = useState<string | null>(null);
  const readBrowser = () => void browserStatus().then(setBrowser, () => {});
  useEffect(() => {
    readBrowser();
    window.addEventListener('focus', readBrowser); // Node 를 깔고 돌아오면 다시 본다
    return () => window.removeEventListener('focus', readBrowser);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // 설치 중엔 5초마다 — 끝나면 줄이 "준비됐어요"로 바뀐다
    if (!browserCmd) return;
    const t = setInterval(readBrowser, 5000);
    return () => clearInterval(t);
  }, [browserCmd]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const read = () => void notifyStatus().then(setNotify, () => {});
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
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
  const startTrust = async (which: 'dev' | 'hq') => {
    setError(null);
    try {
      // 믿으려면 폴더가 있어야 한다 — 프로젝트 폴더는 만들고, HQ 는 템플릿으로 만든다
      if (which === 'dev') { await makeDir(draft.devRoot); setDev(await folderStatus(draft.devRoot)); }
      else if (!(await folderStatus(draft.hqDir)).hqReady) { await createHq(draft.hqDir); setHq(await folderStatus(draft.hqDir)); }
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
  const run = (t: SetupTask) => setTask(t);
  const ready = setupReady(check);
  const fit = check?.claudeVersion ? versionFit(check.claudeVersion) : 'unknown';
  const ver = parseClaudeVersion(check?.claudeVersion ?? '')?.join('.') ?? check?.claudeVersion;

  const makeHq = async () => {
    setError(null);
    try {
      const r = await createHq(draft.hqDir);
      setNote(r.kept.length
        ? tr(`HQ 를 만들었어요 — 새 파일 ${r.written.length}개, 이미 있던 ${r.kept.length}개는 그대로 뒀어요.`, `HQ is ready — ${r.written.length} new files; ${r.kept.length} existing files were left as they were.`)
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
        if (!(await folderStatus(draft.hqDir)).hqReady) await createHq(draft.hqDir);
      }
      const next = { ...draft, setupDone: true };
      await writeConfig(next);
      mirror(next);
      await rebuildMenu().catch(() => {}); // 메뉴가 옛 글자로 남아도 다음에 켜면 바뀐다
      if (firstRun && orchestratorNames.length === 0) {
        // 저장한 설정의 HQ 에서 비서를 띄운다(이름은 새 이름으로)
        setAssistant(next.assistantName);
        const env = await getAppEnv();
        await spawnSession(env.orchestratorCwd, nextOrchestratorName(orchestratorNames), tr('세션 준비됐어. 지시 기다릴게.', 'Session ready. Waiting for instructions.'));
      }
      reopen();
    } catch (e: unknown) {
      setError(tr(`저장하지 못했어요: ${String(e)}`, `Could not save: ${String(e)}`));
      setBusy(false);
    }
  };

  const claudeRow = !check ? null : check.claudePath ? (
    fit === 'old' ? (
      <Row state="need" title="Claude Code" text={tr(`설치돼 있는데 옛 버전이에요 (${ver}). Chammo 는 2.1.280 이상이 필요해요 — 버튼을 누르면 아래 터미널에서 최신으로 올려요.`, `Installed, but old (${ver}). Chammo needs 2.1.280 or later — the button updates it to the latest in the terminal below.`)}>
        <button className="btn pri" onClick={() => run('update')}>{tr('업데이트', 'Update')}</button>
      </Row>
    ) : (
      <Row state="ok" title="Claude Code" text={tr(`설치돼 있어요 (${ver || check.claudePath}).`, `Installed (${ver || check.claudePath}).`)} />
    )
  ) : (
    <Row state="need" title="Claude Code" text={tr('아직 없어요. 버튼을 누르면 아래 터미널에서 공식 설치 스크립트를 돌려요. 1~2분이면 끝나요.', 'Not installed yet. The button runs the official install script in the terminal below — it takes a minute or two.')}>
      <button className="btn pri" onClick={() => run('install')}>{tr('설치하기', 'Install')}</button>
    </Row>
  );

  const num = (n: number) => (firstRun ? '' : `${n}. `);
  const langSec = (
        <section className="su-sec">
          <h2>{num(1)}{tr('언어', 'Language')}</h2>
          <div className="su-seg" role="radiogroup" aria-label={tr('언어', 'Language')}>
            {(['ko', 'en'] as Lang[]).map((l) => (
              <button key={l} role="radio" aria-checked={draft.language === l} className={draft.language === l ? 'on' : ''} onClick={() => void pickLanguage(l)}>
                {l === 'ko' ? '한국어' : 'English'}
              </button>
            ))}
          </div>
        </section>
  );
  const checkSec = (
        <section className="su-sec">
          <div className="su-sec-head">
            <h2>{num(2)}{tr('이 맥 점검', 'Check this Mac')}</h2>
            <button className="btn" disabled={checking} onClick={() => void recheck()}>{checking ? tr('확인하는 중…', 'Checking…') : tr('다시 확인', 'Check again')}</button>
          </div>
          {!check ? <div className="su-hint">{tr('필요한 도구가 있는지 보고 있어요…', 'Looking for the tools Chammo needs…')}</div> : (
            <div className="su-rows">
              {claudeRow}
              {check.claudePath && (check.loggedIn
                ? <Row state="ok" title={tr('Claude 로그인', 'Claude sign-in')} text={tr('로그인돼 있어요. Chammo 는 이 로그인을 그대로 써요.', 'Signed in. Chammo uses this sign-in as is.')} />
                : <Row state="need" title={tr('Claude 로그인', 'Claude sign-in')} text={tr('로그인이 필요해요. 버튼을 누르면 브라우저가 열려요 — 로그인하고 돌아오면 돼요.', 'You need to sign in. The button opens your browser — sign in and come back.')}>
                    <button className="btn pri" onClick={() => run('login')}>{tr('로그인하기', 'Sign in')}</button>
                  </Row>)}
              {check.clt
                ? <Row state="ok" title={tr('git (Xcode 명령줄 도구)', 'git (Xcode Command Line Tools)')} text={tr('있어요.', 'Installed.')} />
                : <Row state="need" title={tr('git (Xcode 명령줄 도구)', 'git (Xcode Command Line Tools)')} text={tr('git 이 들어 있는 Apple 도구예요. 누르면 macOS 설치 창이 떠요 — 설치에 몇 분 걸려요.', "Apple's tools that include git. The button opens the macOS installer — it takes a few minutes.")}>
                    <button className="btn pri" onClick={() => run('clt')}>{tr('설치하기', 'Install')}</button>
                  </Row>}
              {check.ghUser
                ? <Row state="ok" title={tr('GitHub CLI (선택)', 'GitHub CLI (optional)')} text={tr(`${check.ghUser} 로 로그인돼 있어요.`, `Signed in as ${check.ghUser}.`)} />
                : check.ghPath
                  ? <Row state="opt" title={tr('GitHub CLI (선택)', 'GitHub CLI (optional)')} text={tr('설치돼 있지만 로그인 전이에요. PR 리뷰에만 필요해요.', 'Installed but not signed in. Only needed for PR review.')}>
                      <button className="btn" onClick={() => run('ghLogin')}>{tr('로그인하기', 'Sign in')}</button>
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
                command={setupCommand(task, { claude: check?.claudePath, gh: check?.ghPath }, doneLine)}
                title={task === 'install' ? tr('Claude Code 설치', 'Installing Claude Code') : task === 'update' ? tr('Claude Code 업데이트', 'Updating Claude Code') : task === 'login' ? tr('Claude 로그인', 'Claude sign-in') : task === 'clt' ? tr('명령줄 도구 설치', 'Installing Command Line Tools') : tr('GitHub 로그인', 'GitHub sign-in')}
                subtitle={tr('이 창에 바로 입력할 수 있어요', 'You can type in this window')}
                fontSize={fontSize}
                controls={<button className="btn su-mini" onClick={() => { setTask(null); void recheck(); }}>{tr('닫기', 'Close')}</button>}
              />
            </div>
          )}
        </section>
  );
  const basicsSec = (
        <section className="su-sec">
          <h2>{num(3)}{tr('기본 설정', 'Basics')}</h2>
          <Field label={tr('비서 이름', 'Assistant name')} hint={tr('세션 목록·알림에 이 이름으로 보여요.', 'Shown in the session list and notifications.')}>
            <input value={draft.assistantName} placeholder={defaultName} onChange={(e) => set('assistantName', e.target.value)} />
          </Field>
          <Field label={tr('프로젝트 폴더', 'Projects folder')} hint={dev && !dev.exists
            ? <>{tr('아직 없는 폴더예요.', 'This folder does not exist yet.')} <button type="button" className="btn su-mini" onClick={() => void createDev()}>{tr(`${draft.devRoot} 만들기`, `Create ${draft.devRoot}`)}</button></>
            : tr('프로젝트(git 저장소)들이 들어 있는 폴더. 그 안의 폴더 하나가 프로젝트 하나예요.', 'The folder that holds your projects (git repos). Each folder inside is one project.')}>
            {pick('devRoot', tr('프로젝트들이 들어 있는 폴더를 골라 주세요', 'Choose the folder that holds your projects'))}
          </Field>
          {/* label 로 감싸지 않는다 — 라벨 글자를 누르면 안의 첫 버튼(첫 폴더 빼기)이 눌린다 */}
          <div className="su-field su-field-list">
            <div className="su-list-row">
              <span className="su-label">{tr('따로 둔 프로젝트', 'Other projects')}</span>
              <span className="su-extras">
                {extras.map((p) => (
                  <span className="su-extra" key={p}>
                    <code>{p}</code>
                    <button type="button" className="btn su-mini" onClick={() => set('extraProjects', extras.filter((x) => x !== p))}>{tr('빼기', 'Remove')}</button>
                  </span>
                ))}
                <button type="button" className="btn su-add" onClick={() => void addExtra()}>{tr('폴더 추가', 'Add folder')}</button>
              </span>
            </div>
            <div className="su-hint">{tr('프로젝트 폴더 밖에 있는 폴더도 하나씩 추가할 수 있어요. 옮기지 않고 그 자리에서 프로젝트로 보여요.', 'Add folders that live outside the projects folder, one by one. They stay where they are and show up as projects.')}</div>
          </div>
          <Field label={tr('HQ 폴더', 'HQ folder')} hint={hq?.hqReady
            ? tr(`준비됐어요. ${name}가 여기서 일해요.`, `Ready. ${name} works from here.`)
            : <>{tr(`${name}가 일하는 폴더예요. 안내문(CLAUDE.md)과 도구(scripts)를 넣어 만들어요.`, `The folder ${name} works from. It gets a guide (CLAUDE.md) and tools (scripts).`)} <button type="button" className="btn su-mini" onClick={() => void makeHq()}>{tr('HQ 만들기', 'Create HQ')}</button></>}>
            {pick('hqDir', tr('HQ 로 쓸 폴더를 골라 주세요 — 새 폴더를 만들어 골라도 돼요', 'Choose a folder for HQ — you can make a new one here'))}
          </Field>
          <Field label={tr('GitHub 아이디', 'GitHub username')} hint={tr('다마고치 CI 배틀과 PR 리뷰에 써요. 비워 둬도 돼요.', 'Used for the Tamagotchi CI battle and PR review. You can leave it empty.')}>
            <input value={draft.githubUser} onChange={(e) => set('githubUser', e.target.value)} spellCheck={false} />
          </Field>
          <Field label={tr('음성 명령', 'Speech command')} hint={tr('읽을 글자를 마지막에 붙여 불러요. 기본은 macOS 의 say.', 'Called with the text as the last argument. The default is macOS say.')}>
            <span className="su-inline">
              <input value={draft.ttsCommand} placeholder="say" onChange={(e) => set('ttsCommand', e.target.value)} spellCheck={false} />
              <button type="button" className="btn" onClick={() => void ttsTest(draft.ttsCommand, tr(`안녕하세요, ${name}예요.`, `Hi, I'm ${name}.`)).catch((e: unknown) => setError(String(e)))}>{tr('들어보기', 'Test')}</button>
            </span>
          </Field>
          <Field label={tr('메모 폴더', 'Notes folder')} hint={tr('프로젝트별 메모(⌘M)가 저장되는 곳.', 'Where per-project notes (⌘M) are saved.')}>
            {pick('memoDir', tr('메모를 저장할 폴더를 골라 주세요', 'Choose where notes are saved'))}
          </Field>
          <div className="su-rows su-trust">
            <div className="su-hint">{tr('Claude Code 는 처음 보는 폴더에서 일하기 전에 "이 폴더를 믿나요?"를 한 번 물어요. 두 폴더를 한 번씩 믿어 주세요 — 프로젝트 폴더를 믿으면 그 안의 프로젝트는 따로 안 물어요.', 'Before working in a new folder, Claude Code asks once whether you trust it. Trust these two folders once — trusting the projects folder covers every project inside it.')}</div>
            {(['dev', 'hq'] as const).map((w) => (
              <Row key={w} state={trust[w] ? 'ok' : 'need'} title={w === 'dev' ? tr('프로젝트 폴더 믿기', 'Trust the projects folder') : tr('HQ 폴더 믿기', 'Trust the HQ folder')}
                text={trust[w] ? tr('믿는 폴더예요.', 'Trusted.') : tr('누르면 아래에 터미널이 열려요. 질문이 나오면 아래 화살표(↓)로 "Yes, I trust this folder"를 고르고 Enter — 창은 저절로 닫혀요.', 'The button opens a terminal below. When asked, press the down arrow (↓) to pick "Yes, I trust this folder", then Enter — the window closes by itself.')}>
                {!trust[w] && <button className="btn pri" disabled={!!trusting} onClick={() => void startTrust(w)}>{tr('믿기', 'Trust')}</button>}
              </Row>
            ))}
            {trusting && (
              <div className="su-term">
                <TerminalPane
                  key={`trust-${trusting}`}
                  command={setupCommand('trust', { claude: check?.claudePath }, '', abs(trusting === 'dev' ? draft.devRoot : draft.hqDir))}
                  title={tr('폴더 믿기', 'Trust folder')}
                  subtitle={tr('↓ 로 Yes 고르고 Enter', '↓ to Yes, then Enter')}
                  fontSize={fontSize}
                  controls={<button className="btn su-mini" onClick={() => { setTrusting(null); void refreshTrust(); }}>{tr('닫기', 'Close')}</button>}
                />
              </div>
            )}
          </div>
        </section>
  );
  const featSec = (
        <section className="su-sec">
          <h2>{num(4)}{tr('기능', 'Features')}</h2>
          <p className="su-hint">{tr('꺼 두면 그 버튼과 메뉴가 숨어요. 언제든 여기서 다시 켤 수 있어요.', 'Turned-off features hide their buttons and menus. You can turn them back on here any time.')}</p>
          {(() => {
            const n = notifyRow(notify);
            return (
              <div className="su-rows">
                <Row state={n.state} title={tr('알림', 'Notifications')}
                  text={n.state === 'ok' ? tr('켜져 있어요. 결정이 필요하거나 답을 기다리면 알려 드려요.', 'On. You get told when a decision or an answer is needed.')
                    : n.action === 'settings' ? tr('꺼져 있어요. 시스템 설정 > 알림 > Chammo 에서 "알림 허용"을 켜 주세요 — 안 켜면 결정 대기·답 필요 알림이 안 와요.', 'Off. Turn on "Allow notifications" in System Settings > Notifications > Chammo — otherwise you miss decision and answer alerts.')
                    : n.action === 'request' ? tr('결정이 필요하거나 답을 기다릴 때 알려 드려요. 버튼을 누르면 macOS 가 한 번 물어봐요.', 'Get told when a decision or an answer is needed. The button makes macOS ask once.')
                    : tr('이 빌드에서는 확인할 수 없어요.', 'Cannot be checked in this build.')}>
                  {n.action === 'request' && <button className="btn pri" onClick={() => void notifyRequest().then(() => notifyStatus()).then(setNotify, () => {})}>{tr('알림 허용', 'Allow')}</button>}
                  {n.action === 'settings' && <button className="btn" onClick={() => void notifyOpenSettings()}>{tr('설정 열기', 'Open Settings')}</button>}
                </Row>
              </div>
            );
          })()}
          {(() => {
            const b = browserRow(browser);
            return (
              <div className="su-rows">
                <Row state={b.state} title={tr('브라우저 자동화 (선택)', 'Browser automation (optional)')}
                  text={b.state === 'ok' ? tr('준비됐어요. 새 프로젝트마다 로그인이 유지되는 브라우저를 따로 줘서, 여러 세션이 웹 작업을 해도 안 부딪혀요.', 'Ready. Each new project gets its own browser that stays logged in, so sessions working on the web never collide.')
                    : b.action === 'install' ? tr('세션이 웹사이트를 열고 누르고 확인하게 해요. 프로젝트마다 따로 된 브라우저라 안 부딪혀요. 버튼을 누르면 아래 터미널에서 받아요(1분쯤).', 'Lets sessions open, click and check websites — a separate browser per project, so they never collide. The button downloads it in the terminal below (about a minute).')
                    : b.action === 'getNode' ? tr(`Node.js ${browser?.nodeVersion ? `(${browser.nodeVersion}, 20 이상 필요)` : ''}가 있어야 해요. 받아서 깔고 이 화면으로 돌아오면 설치 버튼이 나와요.`, `Needs Node.js ${browser?.nodeVersion ? `(${browser.nodeVersion}; 20 or later)` : ''}. Install it, come back here, and the install button appears.`)
                    : tr('확인하는 중…', 'Checking…')}>
                  {b.action === 'install' && <button className="btn pri" onClick={() => void browserInstallCommand().then(setBrowserCmd, (e: unknown) => setError(String(e)))}>{tr('설치하기', 'Install')}</button>}
                  {b.action === 'getNode' && <button className="btn" onClick={() => void openTarget('url', 'https://nodejs.org/en/download')}>{tr('Node.js 받기', 'Get Node.js')}</button>}
                </Row>
                {b.state === 'ok' && browser && !browser.chrome && <div className="su-hint">{tr('구글 크롬이 있어야 브라우저가 떠요 — 없으면 google.com/chrome 에서 받아 주세요.', 'Google Chrome is needed for the browser to open — get it from google.com/chrome.')}</div>}
                {browserCmd && (
                  <div className="su-term">
                    <TerminalPane key="browser-install" command={browserCmd} title={tr('브라우저 자동화 설치', 'Installing browser automation')} fontSize={fontSize}
                      controls={<button className="btn su-mini" onClick={() => { setBrowserCmd(null); readBrowser(); }}>{tr('닫기', 'Close')}</button>} />
                  </div>
                )}
              </div>
            );
          })()}
          <div className="su-feats">
            {features().map(([k, label, text]) => (
              <label key={k} className="su-feat">
                <input type="checkbox" checked={draft.features[k]} onChange={(e) => set('features', { ...draft.features, [k]: e.target.checked })} />
                <span><b>{label}</b><span>{text}</span></span>
              </label>
            ))}
          </div>
        </section>
  );
  // 마지막 단계 — 고른 것 한눈에
  const readySec = (
        <section className="su-sec">
          <h2>{tr('준비 끝', 'All set')}</h2>
          <p className="su-hint">{tr(`시작하기를 누르면 HQ 폴더를 만들고 ${name}를 깨워요. 처음 인사가 오면 말을 걸어 보세요 — 예: "acme-shop 에 README 정리 시켜줘".`, `Press Get started to create the HQ folder and wake up ${name}. When it says hello, talk to it — e.g. "ask acme-shop to tidy up its README".`)}</p>
          <dl className="su-sum">
            <dt>{tr('비서 이름', 'Assistant')}</dt><dd>{name}</dd>
            <dt>{tr('프로젝트 폴더', 'Projects')}</dt><dd>{draft.devRoot}</dd>
            <dt>{tr('HQ 폴더', 'HQ')}</dt><dd>{draft.hqDir}</dd>
            <dt>{tr('음성', 'Speech')}</dt><dd>{draft.ttsCommand || 'say'}</dd>
          </dl>
        </section>
  );
  const [step, setStep] = useState<WizardStep>('welcome');
  const at = WIZARD.indexOf(step);
  const sectionOf: Record<WizardStep, ReactNode> = { welcome: langSec, check: checkSec, basics: basicsSec, features: featSec, ready: readySec };

  return (
    <div className="setup" role="dialog" aria-modal="true" aria-label={tr('설정', 'Settings')}>
      <div className="setup-page">
        <header className="su-head">
          <div>
            <h1>{firstRun ? tr('Chammo 에 오신 걸 환영해요', 'Welcome to Chammo') : tr('설정', 'Settings')}</h1>
            <p>{firstRun
              ? (step === 'welcome' ? tr('Chammo 는 Claude Code 세션들을 굴리는 참모예요. 결정은 당신이, 일은 참모가. 다섯 단계면 끝나요.', 'Chammo is a chief of staff that runs your Claude Code sessions. You make the calls; it runs the team. Five short steps and you are in.') : tr(`${at + 1} / ${WIZARD.length} 단계`, `Step ${at + 1} of ${WIZARD.length}`))
              : tr('바꾼 값은 저장하면 바로 적용돼요. 언어와 비서 이름은 창을 다시 열면서 바뀌어요.', 'Changes apply when you save. Language and assistant name take effect as the window reopens.')}</p>
          </div>
          {!firstRun && <button className="btn" onClick={onClose}>{tr('닫기', 'Close')}</button>}
        </header>
        {firstRun && (
          <ol className="su-steps" aria-label={tr('진행', 'Progress')}>
            {WIZARD.map((w, i) => <li key={w} className={i < at ? 'done' : i === at ? 'on' : ''} />)}
          </ol>
        )}

        {firstRun ? sectionOf[step] : <>{langSec}{checkSec}{basicsSec}{featSec}</>}

        <footer className="su-foot">
          {note && <div className="su-note">{note}</div>}
          {error && <div className="su-error">{error}</div>}
          {firstRun && step === 'check' && !canNext('check', check) && check && <div className="su-hint">{tr('위의 Claude Code 설치·로그인과 명령줄 도구가 끝나면 다음으로 갈 수 있어요.', 'Finish installing and signing in to Claude Code, and the Command Line Tools, to continue.')}</div>}
          {firstRun ? (
            <div className="su-nav">
              {at > 0 && <button className="btn" disabled={busy} onClick={() => setStep(WIZARD[at - 1]!)}>{tr('뒤로', 'Back')}</button>}
              <span className="grow" />
              {step === 'ready'
                ? <button className="btn pri su-go" disabled={busy || !ready} onClick={() => void finish()}>{busy ? tr('준비하는 중…', 'Getting ready…') : tr('시작하기', 'Get started')}</button>
                : <button className="btn pri su-go" disabled={!canNext(step, check, trust)} onClick={() => setStep(WIZARD[at + 1]!)}>{tr('다음', 'Next')}</button>}
            </div>
          ) : (
            <button className="btn pri su-go" disabled={busy} onClick={() => void finish()}>{busy ? tr('준비하는 중…', 'Getting ready…') : tr('저장', 'Save')}</button>
          )}
        </footer>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { accountsApi, baseTools, browserSetupStart, browserSetupState, browserStatus, checkEnv, createHq, firstRunWindow, folderStatus, getAppEnv, makeDir, notifyRequest, openTarget, pickFolder, rebuildMenu, trustConsent, trustConsented, trustFolders, writeConfig, type Config } from '../data/tauri';
import { hiddenRun, type Hidden } from '../data/hiddenRun';
import { addState, type AccountsView } from '../domain/accounts';
import { AUTO_NEXT_MS, LOGIN_LIMIT_MS, canSkip, doneCount, failKind, itemOk, itemsFor, lineLength, loginCommand, needsManualGet, nextItem, resumeScreen, retryItem, setItem, type FailKind, type FrScreen, type Item, type ItemKey , FIRST_SPAWN_KEY } from '../domain/firstRun';
import { IS_WIN } from '../domain/reader';
import { GET_URL, firstRunName, setupCommand, shq, tildify, versionFit, winSetupNotes, type EnvCheck } from '../domain/setup';
import { tr } from '../i18n';
import { pinActive } from './accountSwitch';
import { IconNext, IconRefresh } from './Icons';
import { IconButton } from './kit/IconButton';
import { mirrorConfig, reloadApp } from './setupFinish';
import './firstRun.css';

// 첫 설치 — 640×440 고정 창 4장(시작 → 준비 → Claude 로그인 → 끝). 사람 몫은 시작·로그인·시작하기뿐, 나머지는 저절로(ADR 0027, 시안 onboarding v1 C)

const RETRY_MS = 20_000;

const ITEM: Record<ItemKey, () => string> = {
  tools: () => tr('참모 도구', 'Assistant tools'),
  git: () => 'Git',
  python: () => tr('파이썬', 'Python'),
  claude: () => 'Claude Code',
  browser: () => tr('참모 브라우저', 'Assistant browser'),
  folder: () => tr('작업 폴더', 'Work folder'),
};
const FAIL: Record<FailKind, () => string> = {
  net: () => tr('인터넷을 확인해 주세요', 'Check your connection'),
  other: () => tr('받지 못했어요', 'Download failed'),
  noWinget: () => tr('직접 받은 뒤 다시 시도해 주세요', 'Get it yourself, then try again'),
};

const Check = () => <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7.5 5.5 11 12 3.5" /></svg>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine);
const old = (c: EnvCheck) => versionFit(c.claudeVersion) === 'old';
/** 터미널 글 끝 줄(색 코드 뺌) */
const lastLine = (t: string) => t.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 300) ?? '';

export function FirstRun({ config }: { config: Config }) {
  const [draft, setDraft] = useState(config);
  const [home, setHome] = useState('');
  /** null = 동의 기록을 읽는 중 — 시작을 눌렀으면 준비부터(껐다 켜도 이어 하기) */
  const [screen, setScreen] = useState<FrScreen | null>(null);
  const [items, setItems] = useState<Item[]>(() => itemsFor(IS_WIN));
  const [check, setCheck] = useState<EnvCheck | null>(null);
  const [login, setLogin] = useState<'idle' | 'wait' | 'late' | 'ok'>('idle');
  const [more, setMore] = useState<{ start: string | null; known?: boolean } | null>(null);
  const [hold, setHold] = useState(false);
  const [accounts, setAccounts] = useState<AccountsView | null>(null);
  const [party, setParty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<ItemKey | null>(null);
  /** 왜 실패했나 원문 — 글을 줄이려고 줄엔 안 쓰고 올리면 보인다(문의·실측용) */
  const [why, setWhy] = useState('');
  const alive = useRef(true);
  const hidden = useRef<Hidden | null>(null);
  const limit = useRef<number | undefined>(undefined);

  useEffect(() => {
    alive.current = true;
    void getAppEnv().then((e) => setHome(e.home)).catch(() => {});
    void trustConsented().then((c) => setScreen(resumeScreen(c)), () => setScreen('start'));
    return () => { alive.current = false; hidden.current?.stop(); window.clearTimeout(limit.current); };
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await makeDir(draft.devRoot); // 있으면 그대로
      await trustConsent(draft.devRoot); // 시작 단추 = 폴더 동의
      await writeConfig(draft);
      setScreen('prep');
    } catch (e: unknown) {
      setError(String(e));
    }
    setBusy(false);
  };
  const changeFolder = async () => {
    try {
      const got = await pickFolder(tr('프로젝트 폴더를 골라 주세요', 'Choose your projects folder'), draft.devRoot);
      if (got) setDraft((d) => ({ ...d, devRoot: tildify(got, home) }));
    } catch (e: unknown) { setError(String(e)); }
  };

  /** 항목 하나 — 이미 있으면 바로 끝. 결과는 터미널 종료가 아니라 다시 재서 본다 */
  const runItem = async (key: ItemKey): Promise<'ok' | FailKind> => {
    if (key === 'tools') {
      const b = await baseTools();
      if (!b.needed || b.python) return 'ok';
      const text = await hiddenRun(`${shq(b.getter)} python`).done;
      if ((await baseTools()).python) return 'ok';
      setWhy(lastLine(text));
      return failKind(text, online());
    }
    if (key === 'claude' || key === 'git' || key === 'python') {
      const c = await checkEnv();
      setCheck(c);
      if (itemOk(key, c, old(c))) return 'ok';
      if (needsManualGet(IS_WIN, key, c)) return 'noWinget';
      const task = key === 'git' ? 'clt' : key === 'python' ? 'python' : c.claudePath ? 'update' : 'install';
      // 끈 앱이 돌리던 설치가 아직 끝나지 않으면 자물쇠에 걸려 바로 실패한다(껐다 켜기 실측) — 망 문제가 아니면 한 번 쉬고 저절로 다시
      let text = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await wait(RETRY_MS);
        text = await hiddenRun(setupCommand(task, { claude: c.claudePath }, '', undefined, IS_WIN, winSetupNotes())).done;
        const after = await checkEnv();
        setCheck(after);
        if (itemOk(key, after, old(after))) return 'ok';
        if (failKind(text, online()) === 'net') break;
      }
      setWhy(lastLine(text));
      return failKind(text, online());
    }
    if (key === 'browser') {
      if ((await browserStatus()).ready) return 'ok';
      await browserSetupStart();
      while (alive.current) {
        await wait(1000);
        const r = await browserSetupState();
        if (r.error) { setWhy(r.error); return failKind(r.error, online()); }
        // 시험 열기까지 통과해야 끝(사용자 11-05 필수). 재기는 node --version 을 부른다 — 맥이 바쁘면 시간 제한에 걸려 '없음'으로 나오니 몇 번 다시
        if (r.done && !r.running) {
          for (let i = 0; i < 4; i++) {
            const st = await browserStatus();
            if (st.ready) return 'ok';
            if (i === 3) setWhy(JSON.stringify(st));
            else await wait(3000);
          }
          return 'other';
        }
      }
      return 'other';
    }
    // 작업 폴더 — 없으면 만들고, 있는 건 안 덮는다
    await makeDir(draft.devRoot);
    if (!(await folderStatus(draft.hqDir)).hqReady) await createHq(draft.hqDir, false, [draft.devRoot, ...(draft.extraProjects ?? [])]);
    await trustFolders(draft.devRoot, draft.hqDir);
    return 'ok';
  };

  useEffect(() => {
    if (screen !== 'prep') return;
    const n = nextItem(items);
    if (n === 'stuck') return;
    if (n === null) {
      const t = window.setTimeout(() => setScreen('login'), 700);
      return () => window.clearTimeout(t);
    }
    if (running.current) return;
    const key = n.key;
    running.current = key;
    setItems((x) => setItem(x, key, 'now'));
    setWhy('');
    void runItem(key).catch((e: unknown) => { setWhy(String(e)); return failKind(String(e), online()); }).then((r) => {
      running.current = null;
      if (!alive.current) return;
      setItems((x) => (r === 'ok' ? setItem(x, key, 'ok') : setItem(x, key, 'fail', r)));
    });
  }, [screen, items]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 로그인 — 숨은 터미널에서. 다시 열기 = 새로 띄우기(브라우저가 새로 열린다), 먼저 뜬 건 끈다 */
  const startLogin = (consoleAccount = false) => {
    hidden.current?.stop();
    window.clearTimeout(limit.current);
    setLogin('wait');
    setError(null);
    const h = hiddenRun(loginCommand(setupCommand('login', { claude: check?.claudePath }, '', undefined, IS_WIN), consoleAccount));
    hidden.current = h;
    limit.current = window.setTimeout(() => { h.stop(); setLogin((l) => (l === 'wait' ? 'late' : l)); }, LOGIN_LIMIT_MS);
    // 브라우저를 안 거치고 끝났으면(취소·실패) 다시 열기만 남긴다 — 마지막 판정은 아래 주기 점검
    void h.done.then(() => { if (hidden.current === h) setLogin((l) => (l === 'wait' ? 'late' : l)); });
  };

  useEffect(() => {
    if (screen !== 'login' || login === 'ok') return;
    let stop = false;
    const look = async () => {
      const c = await checkEnv().catch(() => null);
      if (stop || !c) return;
      setCheck(c);
      if (c.loggedIn) {
        hidden.current?.stop();
        window.clearTimeout(limit.current);
        setLogin('ok');
      }
    };
    void look();
    const t = window.setInterval(() => void look(), 3000);
    return () => { stop = true; window.clearInterval(t); };
  }, [screen, login]);

  // 로그인이 끝나면 잠깐 뒤 저절로 — '계정 추가'를 눌렀으면 멈추고 '다음'
  useEffect(() => {
    if (screen !== 'login' || login !== 'ok' || hold) return;
    const t = window.setTimeout(() => setScreen('done'), AUTO_NEXT_MS);
    return () => window.clearTimeout(t);
  }, [screen, login, hold]);

  /** 계정 추가 — 설정 > 계정과 같은 길: 지금 로그인을 보관 → 새 로그인 → 보관 */
  const addAccount = async () => {
    setHold(true);
    setError(null);
    try {
      const v = await accountsApi.view();
      if (v.liveEmail) setAccounts(await accountsApi.capture());
      setMore({ start: v.liveEmail ?? null });
      hidden.current = hiddenRun(setupCommand('login', { claude: check?.claudePath }, '', undefined, IS_WIN));
    } catch (e: unknown) { setError(String(e)); }
  };
  const cancelAdd = () => { hidden.current?.stop(); setMore(null); };
  useEffect(() => {
    if (!more) return;
    const t = window.setInterval(() => {
      void accountsApi.view().then(async (v) => {
        const st = addState(v, more.start);
        if (st === 'newLogin') {
          hidden.current?.stop();
          setAccounts(await pinActive(await accountsApi.capture()));
          setMore(null);
        } else if (st === 'known') {
          setMore((m) => (m ? { ...m, known: true } : m));
        }
      }, () => {});
    }, 3000);
    return () => window.clearInterval(t);
  }, [more?.start]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (screen !== 'done') return;
    const t = window.setTimeout(() => setParty(true), 250);
    return () => window.clearTimeout(t);
  }, [screen]);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = { ...draft, assistantName: firstRunName(draft.assistantName, draft.language), setupDone: true };
      await writeConfig(next);
      mirrorConfig(next);
      void notifyRequest().catch(() => {}); // 맥이 한 번 묻는다 — 답을 기다리지 않는다
      try { localStorage.setItem(FIRST_SPAWN_KEY, '1'); } catch { /* 저장이 막히면 빈 화면의 새 참모 단추로 */ }
      await rebuildMenu().catch(() => {});
      await firstRunWindow(false).catch(() => {});
      reloadApp();
    } catch (e: unknown) {
      setError(String(e));
      setBusy(false);
    }
  };

  if (!screen) return <div className="fr" role="dialog" aria-modal="true" aria-label="Chammo" />;
  const m = doneCount(items), n = items.length;
  const failed = items.find((i) => i.state === 'fail');
  const title = tr('다 됐어요!', 'All set!');

  return (
    <div className={`fr fr-${screen}${party ? ' party' : ''}${IS_WIN ? ' fr-win' : ''}`} role="dialog" aria-modal="true" aria-label="Chammo">
      <div className="fr-flood" aria-hidden="true" />
      <div className="fr-top"><b>Chammo</b></div>
      <div className="fr-body">
        {screen === 'start' && (
          <section className="fr-scr fr-end">
            <h1>{tr('시작해요', "Let's start")}</h1>
            <div className="fr-row">
              <div className="fr-sub">{tr('여기서 일해요', 'Working in')} <code>{draft.devRoot}</code> <button type="button" className="fr-lnk" onClick={() => void changeFolder()}>{tr('바꾸기', 'Change')}</button></div>
              <button type="button" className="fr-btn" autoFocus disabled={busy} onClick={() => void start()}>{tr('시작', 'Start')}</button>
            </div>
          </section>
        )}
        {screen === 'prep' && (
          <section className="fr-scr">
            <h1>{tr('준비 중이에요', 'Getting ready')}</h1>
            <p role="status">{tr(`${n}개 중 ${m}개`, `${m} of ${n}`)} · {tr('몇 분 걸려요', 'A few minutes')}</p>
            <ul className="fr-list">
              {items.map((i) => (
                <li key={i.key} className={i.state}>
                  <Check />
                  <span>{ITEM[i.key]()}</span>
                  {i.state === 'now' && <small>{i.key === 'folder' ? tr('준비 중', 'Preparing') : tr('설치 중', 'Installing')}</small>}
                  {i.state === 'fail' && i.fail && <small className="fr-fail" role="alert" title={why}>{i.key === 'folder' ? tr('만들지 못했어요', "Couldn't create it") : FAIL[i.fail]()}</small>}
                </li>
              ))}
            </ul>
            {failed && (
              <div className="fr-acts">
                <IconButton size="l" tone="pri" label={tr('다시 시도', 'Try again')} onClick={() => setItems((x) => retryItem(x, failed.key))}><IconRefresh /></IconButton>
                {failed.fail === 'noWinget' && <button type="button" className="fr-lnk" onClick={() => void openTarget('url', GET_URL[failed.key === 'git' ? 'clt' : 'python']).catch(() => {})}>{tr('받기', 'Get')}</button>}
                {canSkip(failed.key) && <button type="button" className="fr-lnk" title={tr('없으면 일부 기능이 안 돼요', "Some features won't work")} onClick={() => setItems((x) => setItem(x, failed.key, 'skip'))}>{tr('나중에', 'Skip')}</button>}
              </div>
            )}
          </section>
        )}
        {screen === 'login' && (
          <section className="fr-scr">
            <h1>{tr('Claude 로그인', 'Sign in to Claude')}</h1>
            {login === 'idle' && (
              <div className="fr-foot">
                <button type="button" className="fr-lnk" onClick={() => startLogin(true)}>{tr('Console 계정 (API 요금)', 'Console account (API)')}</button>
                <button type="button" className="fr-btn" autoFocus onClick={() => startLogin()}>{tr('로그인', 'Sign in')}</button>
              </div>
            )}
            {(login === 'wait' || login === 'late') && (
              <div className="fr-line" role="status">
                {login === 'wait' ? <span className="fr-slide">{tr("브라우저에서 '허용'을 눌러 주세요", 'Click "Allow" in your browser')}</span> : <span>{tr('다시 열어 주세요', 'Please reopen it')}</span>}
                <button type="button" className="fr-lnk" onClick={() => startLogin()}>{tr('다시 열기', 'Reopen')}</button>
                <button type="button" className="fr-lnk" onClick={() => startLogin(true)}>{tr('Console 계정 (API 요금)', 'Console account (API)')}</button>
              </div>
            )}
            {login === 'ok' && (
              <>
                <div className="fr-line" role="status"><svg className="fr-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5 6.5 12.5 13.5 4" /></svg>{tr('로그인됐어요', 'Signed in')}</div>
                {accounts && accounts.accounts.length > 0 && hold && (
                  <ul className="fr-accts">{accounts.accounts.map((a) => <li key={a.id}>{a.email || a.name}</li>)}</ul>
                )}
                {more ? (
                  <div className="fr-line" role="status">
                    {more.known ? <span>{tr('이미 있는 계정이에요', 'Already added')}</span> : <span className="fr-slide">{tr('브라우저에서 다른 계정으로 로그인해 주세요', 'Sign in with another account')}</span>}
                    <button type="button" className="fr-lnk" onClick={cancelAdd}>{tr('취소', 'Cancel')}</button>
                  </div>
                ) : (
                  <div className="fr-foot">
                    <button type="button" className="fr-lnk" onClick={() => void addAccount()}>{tr('계정 추가', 'Add account')}</button>
                    {hold && <IconButton size="l" tone="pri" label={tr('다음', 'Next')} onClick={() => setScreen('done')}><IconNext /></IconButton>}
                  </div>
                )}
              </>
            )}
          </section>
        )}
        {screen === 'done' && (
          <section className="fr-scr fr-end fr-last">
            <svg className="fr-big" viewBox="0 0 100 100" aria-hidden="true"><path d="M18 52 40 74 84 26" /></svg>
            <h1 aria-label={title}>{[...title].map((ch, i) => <span key={i} className="fr-ch" aria-hidden="true" style={{ '--i': i } as React.CSSProperties}>{ch === ' ' ? ' ' : ch}</span>)}</h1>
            <p>{tr('참모에게 "할 일 목록 웹페이지 하나 만들어 줘"라고 해 보세요', 'Try: "Make me a to-do list web page"')}</p>
            {draft.features.usagePing && <p className="fr-note">{tr('하루 한 번 익명 사용 통계를 보내요. 기능별 횟수와 설치 번호·앱 판·OS 같은 정해 둔 값만 보내고, 대화·파일은 안 보내요. 설정 > 기능에서 끌 수 있어요.', 'Once a day Chammo sends anonymous usage statistics: counts and a few fixed values (install ID, app version, OS), never chats or files. Turn it off in Settings > Features.')}</p>}
            <div className="fr-row"><span /><button type="button" className="fr-btn" autoFocus disabled={busy} onClick={() => void finish()}>{tr('시작하기', 'Get started')}</button></div>
          </section>
        )}
        {error && <div className="fr-err" role="alert">{error}</div>}
      </div>
      <div className="fr-hair" style={{ width: `${lineLength(screen, items, login === 'ok') * 100}%` }} aria-hidden="true" />
    </div>
  );
}

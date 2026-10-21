"""scripts/craft 의 윈도우 길 — 참모 앱 portable zip 받기·깔기·띄우기·지우기 (docs/plans/craft-windows.md 단계 2).

맥 길(DMG·공증·/Applications·open -a·pgrep·JXA)을 윈도우에선 이렇게 바꾼다:
- 받기: 참모 앱 공개 릴리스(또는 local-releases.json 폴더)의 chammo-<영문>-<판>-windows-x64-portable.zip + SHA256SUMS.txt
- 깔기: %LOCALAPPDATA%\\Programs\\Chammo\\<이름>\\ — zip 안 chammo-app.json 의 id·판이 맞아야(맥 번들 id·Info.plist 대신). 서명 확인은 없다
- 띄우기: exe 를 env 와 함께 바로(pid 를 바로 받는다). 참모가 띄우면 가상 화면 밖 좌표(CHAMMO_WINDOW_FRAME) — 화면 밖 창도 그리고
  ui.screenshot 이 새 그림을 준다(2026-10-20 실측). 최소화는 그림이 안 와서 안 쓴다. 앞 창을 가져가면 사람이 보던 창으로 되돌린다
- 칸 그림: 띄운 직후·쓰기 명령 뒤 한 장(<데이터>/craft-native/<앱>/pane.png, 상태 파일 pane·paneAt) — 앱이 보는 중엔 1fps 이하로 더 받는다
craft 가 bind(globals()) 로 자기 함수를 넘긴다. Win32 는 os_ 한 곳 — 시험은 가짜로 바꿔 끼운다(scripts/test_craft_win.py)
"""
import hashlib, json, os, re, shutil, subprocess, tempfile, time

# 윈도우 zip 이 있는 참모 앱(2026-10-21 단계 4·5, 시험 PC 에서 앱마다 설치·화면 밖·명령·저장·콘솔 0·지우기).
# 빼야 하면 여기서만 지운다 — 서랍·open 이 그 앱만 '준비 중'으로 막는다.
# 뺀 것: lightcraft — ui.screenshot 에 답한 뒤 5~15초 안에 종료 코드 1 로 꺼진다(로그·패닉·WER 없음, 칸 그림이 1초마다 찍어 바로 꺼짐)
WIN_APPS = {'photocraft', 'vectorcraft', 'wordcraft', 'pdfcraft', 'deckcraft', 'designcraft', 'gridcraft', 'figcraft', 'filmcraft',
            'effectcraft', 'soundcraft', 'cadcraft'}
SUFFIX = '-windows-x64-portable.zip'
INFO = 'chammo-app.json'
OFF = 4000  # 가상 화면 오른쪽 끝에서 이만큼 밖에 창을 둔다


class _Craft:
    """scripts/craft 의 함수·값 — bind 로 받은 globals 를 그때그때 읽는다(시험이 바꿔 끼운 것도 보이게)"""
    g = {}

    def __getattr__(self, k):
        return self.g[k]


C = _Craft()


def bind(g):
    _Craft.g = g


class Win32:
    """진짜 윈도우 — ctypes 는 쓸 때 불러서 맥에서도 이 파일을 읽을 수 있다"""

    def _u(self):
        import ctypes
        return ctypes.WinDLL('user32', use_last_error=True)

    def localappdata(self):
        return os.environ.get('LOCALAPPDATA') or os.path.join(os.path.expanduser('~'), 'AppData', 'Local')

    def appdata(self):
        return os.environ.get('APPDATA') or os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming')

    def virtual_screen(self):
        u = self._u()
        return (u.GetSystemMetrics(76), u.GetSystemMetrics(77), u.GetSystemMetrics(78), u.GetSystemMetrics(79))

    def popen(self, argv, env, cwd):
        flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP — 이 스크립트가 끝나도 앱은 산다
        p = subprocess.Popen(argv, env=env, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=flags, close_fds=True)
        return p.pid

    def pid_alive(self, pid):
        """os.kill(pid, 0) 은 윈도우에서 CTRL_C_EVENT 를 보낸다(살아 있나가 아니다) — OpenProcess + GetExitCodeProcess"""
        import ctypes, ctypes.wintypes as wt
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            return False
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        h = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ctypes.get_last_error() == 5  # 거절(다른 계정 프로세스) = 있긴 하다
        try:
            code = wt.DWORD()
            return bool(k.GetExitCodeProcess(h, ctypes.byref(code))) and code.value == 259  # STILL_ACTIVE
        finally:
            k.CloseHandle(h)

    def kill(self, pid):
        import ctypes
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        h = k.OpenProcess(0x0001, False, int(pid))  # PROCESS_TERMINATE
        if h:
            k.TerminateProcess(h, 1)
            k.CloseHandle(h)

    def windows(self, pid):
        """그 pid 의 보이는 최상위 창 [(hwnd, [x, y, w, h])]"""
        import ctypes, ctypes.wintypes as wt
        u, out = self._u(), []

        @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
        def each(h, _):
            p = wt.DWORD()
            u.GetWindowThreadProcessId(h, ctypes.byref(p))
            if p.value == int(pid) and u.IsWindowVisible(h) and not u.GetWindow(h, 4):  # GW_OWNER 없음
                r = wt.RECT()
                u.GetWindowRect(h, ctypes.byref(r))
                out.append((h, [r.left, r.top, r.right - r.left, r.bottom - r.top]))
            return True
        u.EnumWindows(each, 0)
        return out

    def foreground(self):
        import ctypes, ctypes.wintypes as wt
        u = self._u()
        h = u.GetForegroundWindow()
        p = wt.DWORD()
        if h:
            u.GetWindowThreadProcessId(h, ctypes.byref(p))
        return (h or None, p.value or None)

    def set_foreground(self, hwnd):
        return bool(self._u().SetForegroundWindow(hwnd))

    def move(self, hwnd, x, y):
        self._u().SetWindowPos(hwnd, 0, int(x), int(y), 0, 0, 0x0001 | 0x0004 | 0x0010)  # NOSIZE | NOZORDER | NOACTIVATE

    def trash(self, path):
        """휴지통으로(SHFileOperationW, 되돌리기 가능) — 성공하면 True"""
        import ctypes, ctypes.wintypes as wt

        class Op(ctypes.Structure):
            _fields_ = [('hwnd', wt.HWND), ('wFunc', wt.UINT), ('pFrom', wt.LPCWSTR), ('pTo', wt.LPCWSTR), ('fFlags', ctypes.c_uint16),
                        ('fAnyOperationsAborted', wt.BOOL), ('hNameMappings', ctypes.c_void_p), ('lpszProgressTitle', wt.LPCWSTR)]
        op = Op(None, 3, os.path.abspath(path) + '\0', None, 0x0040 | 0x0010 | 0x0004 | 0x0400, False, None, None)  # FO_DELETE · ALLOWUNDO·NOCONFIRMATION·SILENT·NOERRORUI
        return ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op)) == 0 and not op.fAnyOperationsAborted and not os.path.exists(path)


os_ = Win32()


def lock(f):
    """slot_lock 의 윈도우판 — 파일 첫 바이트를 잠근다(LK_LOCK 은 10번 해 보고 포기해서, 잡힐 때까지 다시)"""
    import msvcrt
    while True:
        f.seek(0)
        try:
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
            return
        except OSError:
            time.sleep(0.05)


def unlock(f):
    import msvcrt
    f.seek(0)
    msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


def supported(app):
    return C.base(app) in WIN_APPS  # app 은 인스턴스 키일 수 있다('gridcraft-2')


def not_yet(app):
    return C.CraftError(f'{C.display(app)}: no Windows build yet — macOS only for now / 윈도우판 준비 중(지금은 맥만)')


def title(app):
    """설치 폴더 이름 — 맥 앱 이름에서('Chammo Grid.app' → 'Grid'). 인스턴스가 여럿이어도 깐 자리는 하나"""
    app = C.base(app)
    name = os.path.basename((C.CHAMMO.get(app) or {}).get('path') or C.APPS[app][0])
    name = name[:-4] if name.endswith('.app') else name
    return name[len('Chammo '):] if name.startswith('Chammo ') else name


def apps_root():
    return os.path.join(os_.localappdata(), 'Programs', 'Chammo')


def app_path(app):
    return os.path.join(apps_root(), title(app))


def info(path):
    """zip 안 chammo-app.json(id·이름·판·원본·exe) — 없거나 깨졌으면 None"""
    try:
        with open(os.path.join(path, INFO), encoding='utf-8') as f:
            j = json.load(f)
        return j if isinstance(j, dict) else None
    except (OSError, ValueError):
        return None


def native_version(path):
    return (info(path) or {}).get('version')


def exe(app):
    p = app_path(app)
    return os.path.join(p, (info(p) or {}).get('exe') or f'{app}.exe')


# ── 받기 ──

def pick_release(app, assets, sums, sums_url):
    """공개 릴리스에서 그 앱의 가장 높은 윈도우 zip — SHA256SUMS 와 자산 목록에 다 있는 것만"""
    pat = re.compile(rf'chammo-{re.escape(C.CHAMMO[app]["short"])}-(\d+\.\d+\.\d+){re.escape(SUFFIX)}')
    found = [(m.group(1), n) for n in sums if (m := pat.fullmatch(n)) and n in assets]
    if not found:
        raise C.CraftError(f'{C.display(app)}: no Windows build in the release {C.CRAFTS_TAG} / 공개 릴리스에 윈도우판이 없음')
    ver, name = max(found, key=lambda f: C._ver_key(f[0]))
    url, size = assets[name]
    return {'app': app, 'tag': 'v' + ver, 'ver': ver, 'pkg': url, 'pkg_name': name, 'sums': sums_url,
            'zip': None, 'zip_name': None, 'dmg': None, 'dmg_size': size, 'cli': None, 'cli_name': None}


def has_pkg(folder):
    try:
        return any(n.endswith(SUFFIX) for n in os.listdir(folder))
    except OSError:
        return False


def local_latest(app, folder):
    """로컬 폴더(우리가 빌드한 zip + SHA256SUMS.txt)를 릴리스처럼 — 설치 확인은 그대로"""
    try:
        names = os.listdir(folder)
    except OSError as e:
        raise C.CraftError(f'local release folder / 로컬 릴리스 폴더: {e}') from e
    pkgs = [n for n in names if re.search(rf'-\d+\.\d+\.\d+{re.escape(SUFFIX)}$', n)]
    if len(pkgs) != 1 or 'SHA256SUMS.txt' not in names:
        raise C.CraftError(f'need one *-<ver>{SUFFIX} and SHA256SUMS.txt / zip 하나와 체크섬 파일이 있어야 함 ({folder})')
    ver = re.search(rf'-(\d+\.\d+\.\d+){re.escape(SUFFIX)}$', pkgs[0]).group(1)
    p = os.path.join(folder, pkgs[0])
    return {'app': app, 'tag': 'v' + ver, 'ver': ver, 'pkg': p, 'pkg_name': pkgs[0], 'sums': os.path.join(folder, 'SHA256SUMS.txt'),
            'zip': None, 'zip_name': None, 'dmg': None, 'dmg_size': os.path.getsize(p), 'cli': None, 'cli_name': None}


def latest(app, get):
    if not supported(app):
        raise not_yet(app)
    if app in C.LOCAL:
        return local_latest(app, C.LOCAL[app])
    local = os.environ.get('CHAMMO_CRAFT_LOCAL', '').strip()
    if local:
        return local_latest(app, local)
    assets, sums, sums_url = C.crafts_release(get)
    return pick_release(app, assets, sums, sums_url)


def install(app, get=None, ddir=None):
    """zip → SHA256SUMS 대조 → 임시 폴더에 풀기(밖으로 나가는 이름 거절) → chammo-app.json id·판·exe 확인 → 설치 자리에 바꿔 끼우기.
    하나라도 안 맞으면 아무것도 안 깔고 CraftError"""
    get = get or C.fetch
    rel = latest(app, get)
    name = rel['pkg_name']
    data = get(rel['pkg'])
    want = C.parse_sums(get(rel['sums']).decode('utf-8', 'replace')).get(name)
    if not want or hashlib.sha256(data).hexdigest() != want:
        raise C.CraftError(f'SHA-256 mismatch or missing / 체크섬이 안 맞거나 없음 ({name}) — thrown away, not installed')
    root = apps_root()
    os.makedirs(root, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='.craft-new-', dir=root)  # 같은 드라이브 — 바꿔 끼우기가 이름 바꾸기 한 번
    try:
        C.safe_extract(data, tmp)
        tops = os.listdir(tmp)
        src = os.path.join(tmp, tops[0]) if len(tops) == 1 and os.path.isdir(os.path.join(tmp, tops[0])) else tmp
        meta = info(src)
        if not meta:
            raise C.CraftError(f'no {INFO} in the zip / zip 안에 {INFO} 가 없음 — not installed')
        if meta.get('id') != C.bundle_id(app):
            raise C.CraftError(f'unexpected app id / 다른 앱: {meta.get("id")} — not installed')
        if meta.get('version') != rel['ver']:
            raise C.CraftError(f'version {meta.get("version")} ≠ {rel["ver"]} in the file name / 판이 파일 이름과 다름 — not installed')
        if not os.path.isfile(os.path.join(src, meta.get('exe') or '')):
            raise C.CraftError(f'no {meta.get("exe")} in the zip / zip 안에 실행 파일이 없음 — not installed')
        dest = app_path(app)
        old = dest + '.craft-old'
        if os.path.exists(dest):
            shutil.rmtree(old, ignore_errors=True)
            try:
                os.rename(dest, old)
            except OSError as e:  # 앱이 떠 있으면 윈도우는 그 폴더를 못 옮긴다
                raise C.CraftError(f'{C.display(app)} is running — close it first / 떠 있어서 못 바꿈 ({e})') from e
        os.rename(src, dest)
        shutil.rmtree(old, ignore_errors=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if ddir:  # 우리가 깐 것 — remove 는 이 기록에 있는 것만 지운다
        recs = C.load_installs(ddir)
        recs[app] = {'path': dest, 'ver': rel['ver'], 'at': time.strftime('%Y-%m-%d')}
        C._write_json(os.path.join(ddir, 'craft-native', 'installed.json'), recs)
    return dest


def icon_file(ddir, app, tag, get=None):
    """서랍 아이콘 — 로컬 폴더나 공개 릴리스의 chammo-<영문>-<판>-icon.png(SHA256SUMS 에 있는 것만). 맥처럼 번들 icns 를 읽지 않는다"""
    if not tag or app not in C.CHAMMO:
        return None
    get = get or C.fetch
    ver = tag.lstrip('v')
    icons = os.path.join(ddir, 'craft-native', 'icons')
    os.makedirs(icons, exist_ok=True)
    out = os.path.join(icons, f'{app}-release-{ver}.png')
    if os.path.exists(out):
        return out
    name = f'chammo-{C.CHAMMO[app]["short"]}-{ver}-icon.png'
    try:
        if app in C.LOCAL:
            folder = C.LOCAL[app]
            sums = C.parse_sums(open(os.path.join(folder, 'SHA256SUMS.txt'), encoding='utf-8').read())
            data = open(os.path.join(folder, name), 'rb').read() if name in sums else None
        else:
            assets, sums, _ = C.crafts_release(get)
            data = get(assets[name][0]) if name in assets and name in sums else None
    except (C.CraftError, OSError, KeyError):
        return None
    if data is None or hashlib.sha256(data).hexdigest() != sums[name]:
        return None
    with open(out + '.tmp', 'wb') as f:
        f.write(data)
    C._replace(out + '.tmp', out)
    return out


# ── 띄우기 ──

def plan_argv(plan, exe_path):
    """맥 띄울 명령(open -n -g -a <앱> --env K=V … --args …) → (윈도우 argv, env) — launch_plan 은 그대로 두고 여기서 바꾼다"""
    argv = plan['argv']
    env = C.child_env()  # 부른 세션의 CLAUDE_* 는 안 물려준다(맥과 같이)
    i = 0
    while i < len(argv) and argv[i] != '--args':
        if argv[i] == '--env' and i + 1 < len(argv):
            k, _, v = argv[i + 1].partition('=')
            env[k] = v
            i += 2
            continue
        i += 1
    args = argv[argv.index('--args') + 1:] if '--args' in argv else []
    return [exe_path] + args, env


def offscreen():
    """참모가 쓰는 창 자리 — 가상 화면(모니터 전부) 오른쪽 밖. 최소화(-32000)는 그림이 안 와서 안 쓴다"""
    x, y, w, _ = os_.virtual_screen()
    return (x + w + OFF, y, 1440.0, 900.0)


def biggest(pid):
    """그 pid 의 진짜 창 — 처음 잠깐 뜨는 16x16 임시 창 말고 가장 큰 것"""
    wins = [(h, r) for h, r in os_.windows(pid) if r[2] > 300 and r[3] > 200]
    return max(wins, key=lambda w: w[1][2] * w[1][3]) if wins else None


def on_screen(r):
    x, y, w, h = os_.virtual_screen()
    return r[0] < x + w and r[1] < y + h and r[0] + r[2] > x and r[1] + r[3] > y


def pane_shot(ddir, app, st, c=None):
    """칸 그림 한 장 — 띄운 직후·쓰기 명령 뒤(앱이 보는 중엔 1fps 이하로 더 받는다). 못 찍어도 명령은 그대로"""
    out = os.path.join(C.native_dir(ddir, app), 'pane.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    asked = out + '.new.png'
    mine = c is None
    try:
        c = c or C.Channel(st)
        res = c.call('ui.screenshot', dict(C.shot_params(app), path=asked))
        png = C.shot_file(res, asked)
    except C.CraftError:
        png = None
    finally:
        if mine and c is not None:
            c.close()
    if os.path.exists(asked):
        os.remove(asked)
    if not png:
        return None
    with open(out + '.tmp', 'wb') as f:
        f.write(png)
    C._replace(out + '.tmp', out)
    status = C.load_status(ddir, app)
    status.update(pane=out, paneAt=time.time())
    C._write_json(C.status_file(ddir, app), status)
    return out


def open_native_ctl(ddir, app, work=None, here=False, window=True):
    """윈도우 참모 앱을 조작 채널과 함께 — 맥 open_native_ctl 과 같은 상태 파일·줄, 자리는 화면 밖(here 면 보통 창)"""
    name = C.display(app)
    if not supported(app):
        raise not_yet(app)
    st = C.load_state(ddir, app)
    if st and C.pid_alive(st.get('pid')):
        print(f'{name}: already open / 이미 떠 있음 — work / 작업 폴더: {st.get("work")}')
        if window and not here:
            C.window_line(ddir, 'open', app)
        return 0
    work = os.path.abspath(work or os.path.join(C.native_dir(ddir, app), 'work'))
    os.makedirs(work, exist_ok=True)
    if not native_version(app_path(app)):
        print(f'{name}: installing the Windows app / 윈도우 앱 설치 중(처음 한 번)…', file=__import__('sys').stderr)
        print(f'{name}: installed / 설치함 — {install(C.base(app), ddir=ddir)}', file=__import__('sys').stderr)
    vd = None if here else offscreen()
    plan = C.launch_plan(ddir, app, C.free_port(), work, vd)
    os.makedirs(plan['config'], exist_ok=True)
    auth = C.NATIVE[C.base(app)]['auth']
    if auth == 'token' and not os.path.exists(plan['secret']):
        with open(plan['secret'], 'w', encoding='utf-8') as f:  # %LOCALAPPDATA% 아래 데이터 폴더 — 다른 계정은 기본 권한으로 못 읽는다
            f.write(os.urandom(32).hex() + '\n')
    if auth == 'file' and os.path.exists(plan['secret']):
        os.remove(plan['secret'])
    argv, env = plan_argv(plan, exe(app))
    before = os_.foreground()
    pid = os_.popen(argv, env, work)
    st = {'app': app, 'pid': pid, 'port': plan['port'], 'auth': auth, 'secret': plan['secret'], 'work': work,
          'exe': argv[0], 'here': bool(here), 'win': True}
    try:
        C.wait_channel(st)
    except C.CraftError:
        os_.kill(pid)  # 상태 파일 없이 포트가 열린 채 남지 않게
        raise
    win = None
    for _ in range(60):  # 채널이 창보다 먼저 열릴 때가 있다
        win = biggest(pid)
        if win:
            break
        time.sleep(0.25)
    if win and vd and on_screen(win[1]):
        fp = C.frame_params(vd)  # 창 자리 env 를 모르는 앱 — 뜬 창을 바로 화면 밖으로
        os_.move(win[0], fp['x'], fp['y'])
    now = os_.foreground()
    if before[0] and now[1] == pid and before[1] != pid:
        # 앞 창을 가져갔으면 사람이 보던 창으로(안 그러면 사람 타자가 안 보이는 창으로 간다). 단 윈도우 포그라운드 잠금 때문에
        # 뒤에 있는 이 프로세스의 SetForegroundWindow 는 0 이 될 수 있다(AttachThreadInput 을 써도, 10/21 실측) —
        # 진짜 막는 길은 앱이 안 가져가는 것: 앱 쪽 with_active(false)(CHAMMO_WINDOW_FRAME) + ui.screenshot focus:false(shot_params)
        os_.set_foreground(before[0])
    st['version'] = native_version(app_path(app)) or ''
    st['name'] = name
    C.save_state(ddir, app, st)
    C._write_json(C.status_file(ddir, app), {'last': '', 'dirty': False})
    pane_shot(ddir, app, st)
    where = 'off screen / 화면 밖' if vd else 'normal window / 보통 창'
    print(f'{name}: open with control channel / 조작 채널로 띄움 ({where}) — work / 작업 폴더: {work}')
    if vd and window:
        C.window_line(ddir, 'open', app)
    if not auth:
        print('this app\'s control port has no auth — scripts/craft close when done / 인증 없는 포트라 끝나면 close', file=__import__('sys').stderr)
    return 0


# 설정 env 를 줘도 앱이 홈에 만드는 것(맥 표 extra 의 윈도우판) — (APPDATA|LOCALAPPDATA, 이름). 10/21 시험 PC 에서 remove 뒤 남은 것
WIN_EXTRA = {'cadcraft': [('appdata', 'ai.storyteller.cadcraft')], 'effectcraft': [('localappdata', 'EffectCraft')],  # 이펙트는 프레임 캐시
             'pdfcraft': [('appdata', 'Chammo PDF'), ('localappdata', 'Chammo PDF')]}  # eframe storage_dir — 로그·복구·인스턴스 잠금


_sleep = time.sleep


def _trash(path, tries=24, wait=0.5):
    """끈 직후엔 폴더가 잠겨 있어 휴지통 옮기기가 실패한다(참모 라이트: 끈 1초 뒤 실패·6초 뒤 됨) — 잠깐씩 다시"""
    for i in range(tries):
        if os_.trash(path):
            return True
        if i + 1 < tries:
            _sleep(wait)
    return False


def remove_app(ddir, app):
    """우리가 깐 앱(설치 기록에 있고 chammo-app.json id 가 맞을 때만)·받은 것·설정·작업 폴더(인스턴스마다)·앱이 홈에 만든 것 → 휴지통.
    옮긴 자리 목록. 끝내 못 옮긴 게 있으면 CraftError(설치 기록은 남긴다 — 다시 remove 하면 된다)"""
    if C.live_instances(ddir, app):
        raise C.CraftError(f'{C.display(app)} is open — scripts/craft close {app} first / 떠 있음, 먼저 close')
    gone, stuck = [], []
    recs = C.load_installs(ddir)
    rec = recs.get(app)
    if rec and os.path.isdir(rec['path']) and (info(rec['path']) or {}).get('id') == C.bundle_id(app):
        if not _trash(rec['path']):
            stuck.append(rec['path'])
        else:
            gone.append(rec['path'])
            recs.pop(app)
            C._write_json(os.path.join(ddir, 'craft-native', 'installed.json'), recs)
            try:
                os.rmdir(apps_root())  # 마지막 앱이었으면 빈 Programs\Chammo 도(비어 있을 때만 지워진다)
            except OSError:
                pass
    extra = [os.path.join(getattr(os_, where)(), name) for where, name in WIN_EXTRA.get(C.base(app), [])]
    for p in [os.path.join(ddir, 'craft', app), C.native_dir(ddir, app)] + [C.native_dir(ddir, C.inst_key(app, n)) for n in range(2, C.MAX_INSTANCES + 1)] + extra:
        if os.path.exists(p):
            (gone if _trash(p) else stuck).append(p)
    C.drop_state(ddir, app)
    if stuck:
        raise C.CraftError(f'{C.display(app)}: could not move to the Trash (in use?) / 휴지통으로 못 옮김(쓰는 중?): {", ".join(stuck)} — '
                           f'scripts/craft remove {app} again in a moment / 잠시 뒤 다시')
    return gone

// 윈도우 세션 크롬을 숨은 데스크톱에 띄운다(2026-10-28 인앱 브라우저 윈도우판). spike 실측(윈도우 시험 PC): 숨은 데스크톱(CreateDesktop)만
// 작업 표시줄·Alt+Tab 에 0 — 새 창(window.open) 뒤에도 — 이고 60fps·클릭→화면 26~28ms, 지킴이도 필요 없다(docs/plans/inapp-spike-windows.md 결과).
// 플레이라이트는 크롬을 파이프(--remote-debugging-pipe, fd 3·4)로 붙여 띄운다 → place-at-launch.js 가 그 spawn 을 이 실행기로 바꾸고,
// 실행기는 자기가 받은 시작 정보(파이프가 든 lpReserved2·표준 핸들)를 그대로 lpDesktop 만 바꿔 크롬에 넘긴다. 크롬이 끝나면 같은 종료 코드로 끝난다.
// 실행기는 C# — 윈도우마다 있는 PowerShell(Add-Type)로 한 번 빌드해 <브라우저 루트>/run 에 둔다(소스 해시가 이름, 맥 accessory dylib 와 같은 꼴)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** 세션 크롬들이 같이 쓰는 숨은 데스크톱 — 프로필마다 만들면 데스크톱 힙을 그만큼 먹는다 */
const DESKTOP = 'Chammo-Browser';

const SOURCE = `using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
static class ChammoDesk {
  [StructLayout(LayoutKind.Sequential)]
  struct SI { public int cb; public IntPtr lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr hProcess, hThread; public uint pid, tid; }
  [DllImport("kernel32.dll")] static extern void GetStartupInfoW(out SI si);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateDesktopW(string name, IntPtr dev, IntPtr dm, uint flags, uint access, IntPtr sa);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref SI si, out PI pi);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  // CommandLineToArgvW 규칙대로 감싸기
  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\\""); int bs = 0;
    foreach (char c in a) {
      if (c == '\\\\') { bs++; continue; }
      if (c == '"') { sb.Append('\\\\', bs * 2 + 1); sb.Append('"'); } else { sb.Append('\\\\', bs); sb.Append(c); }
      bs = 0;
    }
    sb.Append('\\\\', bs * 2); sb.Append('"'); return sb.ToString();
  }
  // 데스크톱을 못 만들면 지금 데스크톱에 헤드리스 2배(앱이 CDP 그림으로 칸에 그린다 — 맥 '가짜 화면 없음'과 같은 길)
  static List<string> Headless(List<string> a) {
    var o = a.FindAll(x => !x.StartsWith("--window-position=") && !x.StartsWith("--window-size="));
    o.Add("--headless=new"); o.Add("--force-device-scale-factor=2"); return o;
  }
  static int Main(string[] argv) {
    if (argv.Length < 2) return 2;
    string desk = argv[0], exe = argv[1];
    var rest = new List<string>();
    for (int i = 2; i < argv.Length; i++) rest.Add(argv[i]);
    IntPtr hd = CreateDesktopW(desk, IntPtr.Zero, IntPtr.Zero, 0, 0x10000000 /* GENERIC_ALL */, IntPtr.Zero);
    SI si; GetStartupInfoW(out si);
    si.cb = Marshal.SizeOf(typeof(SI));
    if (hd != IntPtr.Zero) si.lpDesktop = Marshal.StringToHGlobalUni(desk);
    else { Console.Error.WriteLine("[chammo-desk] CreateDesktop " + Marshal.GetLastWin32Error() + " - headless"); rest = Headless(rest); si.lpDesktop = IntPtr.Zero; }
    var cmd = new StringBuilder(Quote(exe));
    foreach (var a in rest) { cmd.Append(' '); cmd.Append(Quote(a)); }
    PI pi;
    // 상속 켬 — 플레이라이트 파이프(fd 3·4)가 lpReserved2 로 크롬에 넘어간다
    if (!CreateProcessW(exe, cmd, IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, null, ref si, out pi)) {
      Console.Error.WriteLine("[chammo-desk] CreateProcess " + Marshal.GetLastWin32Error()); return 3;
    }
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    return (int)code;
  }
}
`;

const HASH = crypto.createHash('sha256').update(SOURCE).digest('hex').slice(0, 8);

/** 실행기 exe — 있으면 그 경로, 없으면 PowerShell 로 빌드(처음 한 번 2~4초). 못 만들면 null */
function ensureLauncher({ root, spawnSync = require('child_process').spawnSync, log = (m) => console.error(m) }) {
  const dir = path.join(root, 'run');
  const exe = path.join(dir, `ChammoDesk-${HASH}.exe`);
  if (fs.existsSync(exe)) return exe;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, `ChammoDesk-${HASH}.${process.pid}.cs`);
    const tmp = path.join(dir, `ChammoDesk-${HASH}.${process.pid}.exe`);
    fs.writeFileSync(src, SOURCE);
    const q = (p) => `'${p.replace(/'/g, "''")}'`;
    const ps = `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${q(src)})) -OutputAssembly ${q(tmp)} -OutputType WindowsApplication`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    try { fs.unlinkSync(src); } catch { /* 없다 */ }
    if (r.error || r.status !== 0 || !fs.existsSync(tmp)) {
      log(`[chammo-browser] 숨은 데스크톱 실행기를 못 만들어 헤드리스로 띄웁니다: ${(r.error && r.error.message) || String(r.stderr || '').trim().slice(-300)}`);
      try { fs.unlinkSync(tmp); } catch { /* 없다 */ }
      return null;
    }
    fs.renameSync(tmp, exe);
    return exe;
  } catch (e) {
    log(`[chammo-browser] 숨은 데스크톱 실행기 준비 실패: ${e.message}`);
    return null;
  }
}

/** 크롬 대신 실행기 — 첫 인자가 데스크톱 이름, 그다음 크롬과 원래 인자 그대로 */
function deskSpawn(cmd, args, exe) {
  return { cmd: exe, args: [DESKTOP, cmd, ...args] };
}

/** 사람 차례 OS 창(패스키·Windows Hello·OS 파일 창) 때 같은 프로필을 보이는 데스크톱에 다시 띄우라는 표시 — 래퍼가 쓰고 지운다(src/winshow.js) */
function visibleFile(liveDir, profile) {
  return path.join(liveDir, `${profile}.visible`);
}

function visibleWanted(liveDir, profile) {
  return !!liveDir && fs.existsSync(visibleFile(liveDir, profile));
}

/** 보이는 창 자리 — 주 화면 왼쪽 위에서 조금 안쪽(작업 표시줄·제목줄이 안 가리게) */
const VISIBLE_POS = [80, 60];

/**
 * 플레이라이트 spawn 바꾸기 — 우리가 자리 인자를 넣은 크롬만(설치 등 다른 띄우기는 null = 그대로).
 * visible = 보이는 데스크톱 자리로 / exe = 숨은 데스크톱 실행기 / 실행기가 없으면 헤드리스 2배
 */
function rewrite(cmd, args, { exe, visible = false }) {
  if (!Array.isArray(args) || !args.some((a) => typeof a === 'string' && a.startsWith('--window-position='))) return null;
  if (visible) return { cmd, args: args.map((a) => (a.startsWith('--window-position=') ? `--window-position=${VISIBLE_POS[0]},${VISIBLE_POS[1]}` : a)) };
  if (exe) return deskSpawn(cmd, args, exe);
  return { cmd, args: require('./place-at-launch').headlessArgs(args) };
}

module.exports = { DESKTOP, SOURCE, ensureLauncher, deskSpawn, rewrite, visibleFile, visibleWanted };

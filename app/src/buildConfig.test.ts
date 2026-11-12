// 빌드 설정 — 공개판(tauri.conf.json)은 Chammo, ad-hoc 서명. 릴리스는 scripts/release-mac.sh 가 Developer ID 로 다시 서명·공증한다
import { describe, expect, it } from 'vitest';
import pub from '../src-tauri/tauri.conf.json';
import indexHtml from '../index.html?raw';
import win from '../src-tauri/tauri.windows.conf.json';
import nsisHooks from '../src-tauri/windows/hooks.nsh?raw';

type Conf = { productName: string; mainBinaryName?: string; identifier: string; app?: { windows: { title: string }[] }; bundle: { targets?: string[]; createUpdaterArtifacts?: boolean; macOS?: { signingIdentity?: string } }; plugins?: { updater?: { pubkey?: string; endpoints?: string[] } } };

describe('빌드 설정', () => {
  it('공개판은 Chammo, 인증서 없이 ad-hoc(-) 서명, .app 과 .dmg', () => {
    const c = pub as Conf;
    expect(c.productName).toBe('Chammo');
    expect(c.mainBinaryName).toBe('Chammo'); // 프로세스 이름 — install.sh 가 켜져 있는지 이 이름으로 본다
    expect(c.identifier).toBe('app.chammo.desktop');
    expect(c.app?.windows[0]?.title).toBe('Chammo');
    // 서명을 아예 안 하면 링커 서명만 남아 받은 맥에서 "손상되었기 때문에 열 수 없습니다"(그래도 열기도 없음) — 아이맥 실측 2026-09-28
    expect(c.bundle.macOS?.signingIdentity).toBe('-');
    expect(c.bundle.targets).toEqual(['app', 'dmg']);
  });

  it('자동 업데이트: GitHub 최신 릴리스의 latest.json, 공개 키가 박혀 있고 업데이트 파일은 릴리스 스크립트만 만든다(ADR 0005)', () => {
    const c = pub as Conf;
    expect(c.plugins?.updater?.endpoints).toEqual(['https://github.com/honorstudio/chammo/releases/latest/download/latest.json']);
    // minisign 공개 키(base64) — 비밀 키는 키체인에만
    expect(atob(c.plugins?.updater?.pubkey ?? '')).toMatch(/^untrusted comment: minisign public key/);
    // 켜 두면 서명 키 없는 사람의 pnpm tauri build 가 깨진다 — release-mac.sh·win-build 가 --config 로 켠다
    expect(c.bundle.createUpdaterArtifacts).toBe(false);
  });

});

describe('문서 제목', () => {
  // 윈도우는 작업 표시줄 미리보기·UI 자동화에 문서 제목이 드러난다 — 'honor-orchestrator' 가 보였다(윈도우 QA 2026-10-05)
  const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
  it('메인 창은 Chammo', () => expect(title(indexHtml)).toBe('Chammo'));
});

describe('윈도우 설치기', () => {
  // 앱을 켠 채 깔면 'OK 를 누르면 종료' 창이 떴다(0.2.4 QA) — 설치·제거 전에 훅으로 조용히 끈다
  it('훅 파일을 쓰고, 설치·제거 앞에서 같은 이름 프로세스를 끈다', () => {
    expect(win.bundle.windows.nsis.installerHooks).toBe('./windows/hooks.nsh');
    for (const m of ['NSIS_HOOK_PREINSTALL', 'NSIS_HOOK_PREUNINSTALL']) {
      const body = new RegExp(`!macro ${m}\\n([\\s\\S]*?)!macroend`).exec(nsisHooks)?.[1] ?? '';
      expect(body).toContain('CHAMMO_QUIET_KILL');
    }
    expect(nsisHooks).toContain('KillProcessCurrentUser "${MAINBINARYNAME}.exe"');
    expect(win.bundle.windows.nsis.installMode).toBe('currentUser');
  });
});

// ADR 0031 · 공개 이슈 #21·#22: 윈도우 10 기본 ConPTY 는 마우스·대체 화면·붙여넣기 괄호를 막는다(윈도우 시험 PC 프로브) — 새 ConPTY 를 exe 옆에
import conpty from '../src-tauri/windows/conpty.json';
import conptyLicense from '../src-tauri/windows/conpty-LICENSE.txt?raw';
import fetchSrc from '../src-tauri/windows/fetch-conpty.mjs?raw';
import { mismatch } from '../src-tauri/windows/fetch-conpty.mjs';
describe('윈도우 새 ConPTY 묶기', () => {
  const w = win as { build?: { beforeBuildCommand?: string }; bundle: { resources?: Record<string, string> } };
  it('NuGet 공식 패키지·고정 판·sha256 셋(패키지·두 파일)', () => {
    expect(conpty.url).toMatch(/^https:\/\/api\.nuget\.org\/v3-flatcontainer\/microsoft\.windows\.console\.conpty\/1\.25\.260930003\//);
    expect(conpty.version).toBe('1.25.260930003');
    for (const h of [conpty.sha256, conpty.files['conpty.dll'].sha256, conpty.files['OpenConsole.exe'].sha256]) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('exe 옆(설치 폴더 맨 위)에 두 파일 — portable-pty 가 conpty.dll 을 이름으로 먼저 찾고, conpty.dll 은 제 옆 OpenConsole.exe 를 띄운다', () => {
    expect(w.bundle.resources).toEqual({ 'windows/conpty/conpty.dll': 'conpty.dll', 'windows/conpty/OpenConsole.exe': 'OpenConsole.exe' });
    expect(w.build?.beforeBuildCommand).toMatch(/^node src-tauri\/windows\/fetch-conpty\.mjs && /);
  });
  it('sha256 이 다르면 멈춘다 — 받은 바이트가 하나라도 다르면 이유 글', () => {
    expect(mismatch('x', Buffer.from('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBeNull();
    expect(mismatch('conpty.dll', Buffer.from('abd'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toMatch(/conpty\.dll sha256 다름/);
    expect(fetchSrc).toContain('process.exit(1)');
  });
  it('고지는 MIT 전문(마이크로소프트 저작권 줄 포함)', () => {
    expect(conpty.license).toBe('MIT');
    expect(conptyLicense).toMatch(/^MIT License\n\nCopyright \(c\) Microsoft Corporation/);
    expect(conptyLicense).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });
});

// 빌드 설정 — 공개판(tauri.conf.json)은 Chammo, ad-hoc 서명. 릴리스는 scripts/release-mac.sh 가 Developer ID 로 다시 서명·공증한다
import { describe, expect, it } from 'vitest';
import pub from '../src-tauri/tauri.conf.json';
import indexHtml from '../index.html?raw';
import widgetHtml from '../widget.html?raw';
import win from '../src-tauri/tauri.windows.conf.json';
import nsisHooks from '../src-tauri/windows/hooks.nsh?raw';

type Conf = { productName: string; mainBinaryName?: string; identifier: string; app?: { windows: { title: string }[] }; bundle: { targets?: string[]; macOS?: { signingIdentity?: string } } };

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

});

describe('문서 제목', () => {
  // 윈도우는 작업 표시줄 미리보기·UI 자동화에 문서 제목이 드러난다 — 'honor-orchestrator' 가 보였다(윈도우 QA 2026-10-05)
  const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
  it('메인 창은 Chammo', () => expect(title(indexHtml)).toBe('Chammo'));
  it('다마고치 창은 창 제목과 같게(개인 이름 없이)', () => expect(title(widgetHtml)).toBe((pub as Conf).app?.windows[1]?.title));
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

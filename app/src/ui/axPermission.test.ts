import { describe, expect, it } from 'vitest';
import keys from '../../src-tauri/src/keys_mac.rs?raw';
import mirror from '../../../tools/craft-mirror/mirror.swift?raw';
import setup from './Setup.tsx?raw';
import pane from './craft/CraftPane.tsx?raw';
import main from '../../src-tauri/src/main.rs?raw';
import tauri from '../data/tauri.ts?raw';
import { axRow } from '../domain/setup';

// 2026-10-19 사용자 "왜 자꾸 뜨는 거임" — 'Chammo Dev 이(가) 손쉬운 사용 기능으로 이 컴퓨터를 제어하려고 합니다' 가 앱을 켤 때마다.
// 맥 권한 창은 앱이 스스로 띄우지 않는다 — 첫 실행 안내·설정 > 기능의 '손쉬운 사용' 줄과, 개입을 처음 누를 때 칸 안 카드로만
describe('손쉬운 사용 — 묻는 창은 띄우지 않는다', () => {
  it('켤 때·자동으로는 묻지 않는다 — 보기(ax_trusted)는 옵션 없이, 묻는 건 ask_ax 한 곳', () => {
    expect(keys).toMatch(/pub fn ax_trusted\(\) -> bool \{\s*unsafe \{ AXIsProcessTrustedWithOptions\(std::ptr::null\(\)\) \}/);
    expect(keys.match(/kAXTrustedCheckOptionPrompt/g)?.length).toBe(2); // extern 선언 + ask_ax 안 한 번
    expect(mirror).not.toMatch(/kAXTrustedCheckOptionPrompt/);
    expect(mirror).not.toMatch(/CGRequestScreenCaptureAccess/);
    // ask_* 는 사람이 누르는 ask_permission 명령에서만
    expect(main.match(/keys_mac::ask_(ax|screen)\(\)/g)?.length).toBe(2);
    expect(main).toMatch(/fn ask_permission\(kind: String\)/);
  });
  it('비추기의 AX 길은 권한부터 본다', () => {
    expect(mirror).toMatch(/static func axOK\(\)/);
    for (const fn of ['func moveWindow', 'func fitSource']) {
      const body = mirror.slice(mirror.indexOf(fn), mirror.indexOf(fn) + 600);
      expect(body, fn).toMatch(/Mirror\.axOK\(\)/);
    }
  });
  it('첫 실행 안내·설정에 줄, 개입 때 카드', () => {
    expect(setup).toMatch(/axBlock/);
    expect(pane).toMatch(/ax_trusted/);
  });
  it('줄 상태', () => {
    expect(axRow(true)).toEqual({ state: 'ok', action: null });
    expect(axRow(false)).toEqual({ state: 'need', action: 'settings' });
  });
});

// 2026-10-19 0.3.4 2차 검증 — 앱이 권한 요청을 한 번도 안 부르면 새 맥의 손쉬운 사용·화면 기록 목록에 Chammo 가 아예 없다(맥은 한 번 요청한 앱만 올린다)
describe('사람이 설정 열기를 누를 때만 한 번 요청 — 목록에 올라가게', () => {
  it('askPermission = 요청(ask_permission) 뒤 설정 화면', () => {
    expect(tauri).toMatch(/export async function askPermission\(kind: 'ax' \| 'screen'\)[\s\S]{0,300}invoke\('ask_permission', \{ kind \}\)[\s\S]{0,300}open_target/);
  });
  it('첫 실행·설정 줄과 Craft 칸의 단추가 다 이 길로', () => {
    expect(setup).toMatch(/askPermission\('ax'\)/);
    expect(setup).toMatch(/askPermission\('screen'\)/);
    expect(pane).toMatch(/askPermission\('ax'\)/);
    expect(pane).toMatch(/askPermission\('screen'\)/);
    expect(pane).not.toMatch(/target: ACCESSIBILITY_URL|target: SCREEN_RECORDING_SETTINGS/);
  });
  it('화면 기록 줄도 첫 실행·설정에 — 보기만(screen_trusted)', () => {
    expect(setup).toMatch(/screenBlock/);
    expect(keys).toMatch(/pub fn screen_trusted\(\) -> bool \{\s*unsafe \{ CGPreflightScreenCaptureAccess\(\) \}/);
  });
});

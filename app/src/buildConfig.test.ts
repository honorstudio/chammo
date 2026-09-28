// 빌드 설정 — 공개판(tauri.conf.json)은 Chammo, ad-hoc 서명. 릴리스는 scripts/release-mac.sh 가 Developer ID 로 다시 서명·공증한다
import { describe, expect, it } from 'vitest';
import pub from '../src-tauri/tauri.conf.json';

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

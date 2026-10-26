import { describe, expect, it } from 'vitest';
import { phoneReachHint } from './phoneReach';
import { setLang } from '../i18n';

// 2026-10-24 사용자 캡처: 설정 > 폰과 메신저의 기기 줄이 한 글자씩 세로로 쌓였다 — '보관함 보여 주기'(.peer-share)가 flex-basis 100% 인데
// 줄(.su-row)이 안 접혀서 글 칸이 0 폭이 됐다. 폰 설명은 0.4.0 전(테일스케일만) 문구였고, Chammo 계정 칸은 맨 아래 묻혀 못 찾았다.
const css = import.meta.glob('/src/ui/setup.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const tsx = import.meta.glob('/src/ui/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sheet = (css['/src/ui/setup.css'] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: (m[1] ?? '').trim(), body: m[2] ?? '' }));
const single = (sel: string) => /^\.[\w-]+$/.test(sel) ? sel.slice(1) : null;

describe('설정 줄(.su-row) 모양', () => {
  it('CSS·TSX 를 읽었다', () => {
    expect(sheet.length).toBeGreaterThan(1000);
    expect(Object.keys(tsx).length).toBeGreaterThan(10);
  });

  it('한 줄을 다 먹는 칸(flex-basis 100%)은 접히는 줄(flex-wrap: wrap) 안에서만 쓴다', () => {
    const full = rules.filter((r) => /flex:\s*[\d.]+\s+[\d.]+\s+100%/.test(r.body)).map((r) => single(r.sel)).filter((c): c is string => !!c);
    const wrap = new Set(rules.filter((r) => /flex-wrap:\s*wrap/.test(r.body)).map((r) => single(r.sel)).filter((c): c is string => !!c));
    expect(full.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const [path, src] of Object.entries(tsx)) {
      for (const c of full) {
        for (const m of src.matchAll(new RegExp(`className="([^"]*\\b${c}\\b[^"]*)"`, 'g'))) {
          // 그 칸 바로 앞의 줄(className="su-row …")이 접히는 줄이어야 한다
          const before = src.slice(0, m.index);
          const row = [...before.matchAll(/className="(su-row(?: [^"]*)?)"/g)].pop();
          if (!row) continue;
          if (!row[1]!.split(' ').some((k) => wrap.has(k))) bad.push(`${path.split('/').pop()}: .${c} in "${row[1]}"`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('이름은 한 줄 말줄임, 설명은 두 줄까지 — 토글·단추는 오른쪽에서 안 줄어든다', () => {
    const b = rules.find((r) => r.sel === '.su-row-text b')!.body;
    expect(b).toMatch(/text-overflow:\s*ellipsis/);
    expect(b).toMatch(/white-space:\s*nowrap/);
    const span = rules.find((r) => r.sel === '.dev-row .su-row-text > span')!.body;
    expect(span).toMatch(/-webkit-line-clamp:\s*2/);
    const share = rules.find((r) => r.sel === '.peer-share')!.body;
    expect(share).toMatch(/flex:\s*0 0 auto/);
    // 기기 줄을 그리는 두 칸이 dev-row 를 단다
    expect(tsx['/src/ui/MobileSection.tsx']).toContain('className="su-row dev-row"');
    expect(tsx['/src/ui/PeerSection.tsx']).toContain('className="su-row dev-row peer-row"');
  });
});

describe('폰 설명 — 계정 로그인 여부로', () => {
  it('로그인돼 있으면 중계로 어디서나, 테일스케일 조건은 안 적는다', () => {
    setLang('ko');
    const h = phoneReachHint(true);
    expect(h.login).toBe(false);
    expect(h.text).toContain('어디서나');
    expect(h.text).not.toContain('테일스케일로만');
  });
  it('로그인 안 됐으면 계정 로그인을 권하고 계정 칸 단추를 띄운다', () => {
    setLang('ko');
    const h = phoneReachHint(false);
    expect(h.login).toBe(true);
    expect(h.text).toContain('Chammo 계정에 로그인하면');
  });
  it('영문도 같은 뜻', () => {
    setLang('en');
    expect(phoneReachHint(true).text).toMatch(/anywhere/);
    expect(phoneReachHint(false).text).toMatch(/Sign in to your Chammo account/);
    setLang('ko');
  });
});

describe('기기 관리·메신저·계정 탭 (10-24 사용자 — 폰과 메신저를 둘로, Chammo 계정은 계정 탭)', () => {
  const body = (k: string) => (tsx['/src/ui/Setup.tsx'] ?? '').split('\n').find((l) => new RegExp(`^\\s*${k}: [<(]`).test(l)) ?? '';
  it('기기 관리 = 폰 연결·다른 기기 참모, 메신저 = 메신저 알림·텔레그램', () => {
    // 기기 관리 = 계정 내 기기 한 목록, 폰 QR·테일넷 다른 기기 참모는 그 아래 접힘 대피로(ADR 0014)
    expect(body('devices')).toContain('<DevicesSection');
    expect(body('devices')).toMatch(/fallback=\{<><MobileSection.*<PeerSection/);
    expect(body('messenger')).toMatch(/<TeamSoundSection[^>]*>.*<MessengerSection/);
    expect(body('devices')).not.toContain('TeamAccountSection');
  });
  it('계정 탭 맨 위가 Chammo 계정, 그 아래 Claude 계정', () => {
    const a = body('accounts');
    expect(a.indexOf('<TeamAccountSection')).toBeGreaterThan(-1);
    expect(a.indexOf('<TeamAccountSection')).toBeLessThan(a.indexOf('<AccountsSection'));
  });
  it('폰 설명의 로그인 단추는 계정 탭으로', () => {
    expect(body('devices')).toContain("onAccount={() => setTab('accounts')}");
  });
});

describe('Chammo 계정 칸 — 중계 주소', () => {
  it('중계 주소 입력칸은 기본 숨김 — 「중계 서버 바꾸기」를 눌렀을 때만(보통 사람에겐 필요 없는 글, 10-24)', () => {
    const src = tsx['/src/ui/TeamAccountSection.tsx'] ?? '';
    const at = src.indexOf("aria-label={tr('중계 서버 주소'");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 300), at)).toMatch(/\{advanced && !v\?\.server && \(/);
  });
});

describe('폰 받지 않음(10-24) — 사람이 폰 연결을 끄면 기기 관리에 한 줄', () => {
  it('기기 관리가 폰 상태의 off 를 보고 안내한다', () => {
    const src = tsx['/src/ui/DevicesSection.tsx'] ?? '';
    expect(src).toContain('setPhoneOff(!!m.off)');
    expect(src).toContain('이 컴퓨터는 폰을 받지 않아요');
  });
});

describe('폰 추가(10-24 사용자 — QR 찍으면 사파리로 열려 홈 화면 앱엔 아무것도 없다)', () => {
  const dev = tsx['/src/ui/DevicesSection.tsx'] ?? '';
  const mob = tsx['/src/ui/MobileSection.tsx'] ?? '';
  it('내 기기의 폰 추가 QR 은 입구 주소만(phone_entry_qr) — 짝 코드 QR(pairNew)은 기기 관리 위쪽에 없다', () => {
    expect(dev).toContain('mobileApi.entryQr()');
    expect(dev).not.toContain('pairNew');
    // 순서: 사파리에서 홈 화면에 추가 → 홈 화면 앱에서 로그인 → 이 컴퓨터 → 숫자
    const steps = ['홈 화면에 추가', '홈 화면의 참모 앱', '구글 로그인', '이 컴퓨터', '숫자'];
    // 앞 단계 뒤에서부터 찾는다 — 다른 줄(새 기기 허용 '숫자' 안내 등)에 같은 낱말이 있어도 순서만 본다
    let pos = 0;
    for (const w of steps) {
      const i = dev.indexOf(w, pos);
      expect(i, w).toBeGreaterThan(-1);
      pos = i;
    }
  });
  it('옛 짝짓기 QR(테일스케일 접힘)엔 사파리에서만 열린다는 경고 — 폰 앱은 위 폰 추가로', () => {
    expect(mob).toContain('사파리에서만 열려');
    expect(mob).toContain("'폰 추가'");
  });
});

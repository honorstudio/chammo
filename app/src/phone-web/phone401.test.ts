// 폰 401 — 열쇠를 조용히 새로 만들지 않고, 풀린 폰에 다시 잇는 길을 보이고, 옛 화면에 묶인 폰에도 닿게. DOM 없이 소스·순수 함수로 지킨다
import { describe, expect, it } from 'vitest';
import { keyPlan } from './keys';
import keysSrc from './keys.ts?raw';
import main from './main.ts?raw';
import reset from './reset.ts?raw';
import relayPush from './relayPush.ts?raw';
import sw from '../../public-phone/sw.js?raw';
import app from '../ui/mobile/MobileApp.tsx?raw';
import { netText } from '../domain/unreach';
import { TrustError } from './hub';

const k = { sign: {}, x: {} };

describe('저장된 열쇠를 어떻게 하나', () => {
  it('둘 다 있으면 쓴다', () => expect(keyPlan(k)).toBe('use'));
  it('줄이 없으면 만든다(처음·forgetKeys 뒤)', () => {
    expect(keyPlan(undefined)).toBe('make');
    expect(keyPlan(null)).toBe('make');
  });
  it('재현: 줄은 있는데 못 읽으면 덮어쓰지 않는다 — 전엔 새 열쇠로 덮어써 멀쩡한 열쇠가 영영 사라졌다', () => {
    expect(keyPlan({ sign: null, x: {} })).toBe('broken');
    expect(keyPlan({ sign: {}, x: null })).toBe('broken');
    expect(keyPlan({ sign: null, x: null })).toBe('broken');
    expect(keyPlan({})).toBe('broken');
  });
});

describe('링크로 서명하는 길은 열쇠를 안 만든다', () => {
  it('linkedKeys 는 저장소에 쓰지 않는다', () => {
    const body = keysSrc.slice(keysSrc.indexOf('export async function linkedKeys'), keysSrc.indexOf('/** 로그인·짝짓기'));
    expect(body).toContain('NoKeysError');
    expect(body).not.toContain('make()');
    expect(body).not.toContain("'readwrite'");
  });
  it('푸시 구독도 링크 길이다', () => {
    expect(relayPush).toContain('await linkedKeys()');
    expect(relayPush).not.toContain('phoneKeys');
  });
});

describe('다시 잇기 — 이미 있는 계정 로그인 길로', () => {
  it('열쇠·링크·토큰·계정·받아 둔 화면을 다 지운다', () => {
    expect(reset).toContain('forgetKeys()');
    expect(reset).toContain('dropShell()');
    expect(reset).toContain('saveLink(null)');
    expect(reset).toContain("'chammo.token'");
    expect(reset).toContain("'chammo.account'");
  });
  it('입구: 풀린 폰엔 다시 잇기, 누르면 /pair(계정 로그인·숫자 확인)', () => {
    expect(main).toContain('e instanceof TrustError');
    expect(main).toContain("'다시 잇기'");
    expect(main).toMatch(/unlinkPhone\(\)\.finally\(\(\) => location\.replace\('\/pair'\)\)/);
  });
  it('폰 화면: TrustError 면 전용 화면, 받으면 풀린다', () => {
    expect(app).toContain("?.name === 'TrustError'");
    expect(app).toContain('setDenied(true)');
    expect(app).toContain('setDenied(false)');
    expect(app).toMatch(/unlinkPhone\(\)\.finally\(\(\) => location\.replace\('\/pair'\)\)/);
  });
  it('폰이 저절로 지우지 않는다 — 사람이 눌러야', () => {
    expect(app.match(/unlinkPhone\(\)/g)).toHaveLength(1);
    expect(app).toMatch(/onClick=\{[^}]*unlinkPhone\(\)/);
  });
  it('안내 글이 QR 이 아니라 다시 잇기다', () => {
    const t = netText(new TrustError());
    expect(t).toContain('풀렸어요');
    expect(t).not.toContain('QR');
    expect(t).not.toContain('저절로');
  });
});

describe('옛 화면에 묶인 폰에도 닿는다 — 받아 둔 화면은 터널이 막히면 새 판을 못 받는다', () => {
  it('입구 워커가 새로 깔리면 받아 둔 껍데기를 한 번 지워 입구를 거친다(화면 파일은 둔다)', () => {
    const act = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf('/** 터널을 가진 창'));
    expect(act).toContain('.delete(SHELL)');
    expect(act).toContain('clients.claim()');
    expect(act).not.toContain('caches.delete(UI)');
  });
});

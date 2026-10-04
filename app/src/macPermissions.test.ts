// macOS 권한 — 앱은 hardened runtime 으로 서명된다. 그러면 하위 세션(claude attach·claude --bg 의 부모 = 이 앱)이
// 마이크·AppleEvents 등을 쓸 때 앱에 entitlement 가 없으면 macOS 가 묻지도 않고 막는다
// (2026-09-27 tccd: "requires entitlement com.apple.security.device.audio-input but it is missing … denied" → Claude Code 음성 입력 "No audio detected").
// 설명 문구(Info.plist)도 있어야 권한 창이 뜬다
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import tauriConf from '../src-tauri/tauri.conf.json';
import entitlements from '../src-tauri/Entitlements.plist?raw';
import infoPlist from '../src-tauri/Info.plist?raw';

const conf = tauriConf as { bundle: { macOS: { entitlements?: string } } };
const FILES: Record<string, string> = { 'Entitlements.plist': entitlements, 'Info.plist': infoPlist };
const plistKeys = (file: string) => [...FILES[file]!.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);

// 24시간 tccd 로그에서 이 앱 때문에 막힌 서비스 전부
const NEEDED: [entitlement: string, usage: string][] = [
  ['com.apple.security.device.audio-input', 'NSMicrophoneUsageDescription'],
  ['com.apple.security.automation.apple-events', 'NSAppleEventsUsageDescription'],
  ['com.apple.security.device.camera', 'NSCameraUsageDescription'],
  ['com.apple.security.personal-information.addressbook', 'NSContactsUsageDescription'],
  ['com.apple.security.personal-information.calendars', 'NSCalendarsUsageDescription'],
];

describe('macOS 권한 — 하위 세션이 쓰는 권한은 앱이 가지고 있어야 한다', () => {
  it('번들이 entitlements 파일을 쓴다', () => expect(conf.bundle.macOS.entitlements).toBe('Entitlements.plist'));
  it.each(NEEDED)('%s entitlement', (ent) => expect(plistKeys('Entitlements.plist')).toContain(ent));
  it.each(NEEDED)('%s → Info.plist 에 %s', (_ent, usage) => {
    expect(plistKeys('Info.plist')).toContain(usage);
    const value = new RegExp(`<key>${usage}</key>\\s*<string>([^<]+)</string>`).exec(infoPlist)?.[1] ?? '';
    expect(value).toMatch(/[가-힣]/); // 권한 창에 한국어로
  });
});

// 맥 기본 창(파일 고르기 시트 등)이 영어(Favorites·Cancel·Open)였다 — 앱이 한국어 지역화를 선언하지 않아 개발 지역(English)으로 떨어졌다(2026-10-04 QA N5).
// 지역화 목록을 선언하면 맥이 사용자 언어 순서대로 고른다: 한국어 사용자 → 한국어, 영어 사용자 → 영어, 그 밖 → 개발 지역(영어) 그대로
describe('macOS 지역화 — 맥 기본 창이 사용자 언어를 따라간다', () => {
  const localizations = /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(infoPlist)?.[1] ?? '';
  const langs = [...localizations.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  it('한국어·영어를 선언한다', () => expect(langs).toEqual(expect.arrayContaining(['ko', 'en'])));
  it('개발 지역은 건드리지 않는다(영어 사용자·다른 언어 사용자는 지금처럼 영어)', () => expect(plistKeys('Info.plist')).not.toContain('CFBundleDevelopmentRegion'));
});

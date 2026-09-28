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

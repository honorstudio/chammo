// 폰 음성 소리 — 화면 쪽 연결이 빠지지 않게(2026-10-11). 오디오·통신 자체는 시뮬레이터 사파리 실측(.shots/feature-phone-voice)
import { describe, expect, it } from 'vitest';
import app from './MobileApp.tsx?raw';
import extras from './ComposerExtras.tsx?raw';
import hook from './usePhoneVoice.ts?raw';
import engine from '../../data/phoneVoice.ts?raw';
import web from '../../data/web.ts?raw';

describe('폰 음성 소리 연결', () => {
  it('앱 맨 위에서 하트비트를 건다(채팅 시트가 닫혀 있어도)', () => {
    expect(app).toMatch(/usePhoneVoice\(\)/);
    expect(hook).toMatch(/setPhoneVoice\(on\)/);
  });
  it('음성 단추를 켜는 누름 안에서 오디오를 푼다', () => {
    const flip = extras.slice(extras.indexOf('const flip'), extras.indexOf('return (', extras.indexOf('const flip')));
    expect(flip).toMatch(/unlockAudio\(\)/);
    expect(flip).toMatch(/setPhoneVoice\(v\)/);
  });
  it('오디오는 touchend·click 에서 푼다(touchstart 는 iOS 가 사람의 누름으로 안 친다)', () => {
    expect(engine).toMatch(/\['touchend', 'click'\][^\n]*gesture/);
  });
  it('음성 모드가 꺼져 있으면 오디오를 안 푼다(안 쓰는 사람의 음악을 끊지 않게)', () => {
    expect(engine).toMatch(/if \(on && !unlocked\) unlockAudio\(\)/);
  });
  it('하트비트·소리 받기에는 시간 제한이 있다(매달린 요청이 고리를 멈추지 않게)', () => {
    expect(engine).toMatch(/BEAT_TIMEOUT_MS/);
    expect(engine).toMatch(/AUDIO_TIMEOUT_MS/);
  });
  it('통신 길은 열쇠 붙는 call 로(voiceBeat·voiceAudioBlob)', () => {
    expect(web).toMatch(/export const voiceBeat/);
    expect(web).toMatch(/export const voiceAudioBlob/);
  });
});

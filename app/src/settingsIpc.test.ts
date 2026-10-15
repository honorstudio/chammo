// 설정을 열면 앱이 굳던 것(2026-10-15 실측) — Tauri 동기 명령은 메인 스레드에서 돈다.
// 목소리 목록(say -v ? 400ms)·브라우저 상태(node --version 여러 번)·폴더 믿기(.claude.json 읽기)는 async 로 둬야 창이 안 멈춘다
import { describe, expect, it } from 'vitest';
import tts from '../src-tauri/src/tts.rs?raw';
import browser from '../src-tauri/src/browser.rs?raw';
import setup from '../src-tauri/src/setup.rs?raw';

describe('설정이 부르는 느린 명령은 메인 스레드를 안 잡는다', () => {
  it.each([
    ['native_voices', tts],
    ['browser_status', browser],
    ['claude_trusted', setup],
  ])('%s 는 async 명령', (name, src) => {
    expect(src).toMatch(new RegExp(`#\\[tauri::command\\]\\s*pub async fn ${name}\\(`));
    expect(src).not.toMatch(new RegExp(`#\\[tauri::command\\]\\s*pub fn ${name}\\(`));
  });
});

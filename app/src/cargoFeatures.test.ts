// Rust 의존성 기능 — 맥 빌드에선 가려지고 윈도우 교차 빌드에서만 깨지는 것.
// 교차 빌드는 호스트용(매크로·빌드 스크립트)과 타깃용 크레이트를 따로 지어서 기능이 안 합쳐진다. 맥은 호스트 = 타깃이라 합쳐져 통과
import { describe, expect, it } from 'vitest';
import cargo from '../src-tauri/Cargo.toml?raw';

describe('Cargo 기능', () => {
  it('zip 의 deflate-flate2 는 압축 백엔드를 안 켠다 — flate2 를 직접 rust_backend 로 둔다(0.3.0 윈도우 빌드 \'choose a zlib backend\')', () => {
    expect(cargo).toMatch(/^zip = \{[^}]*"deflate-flate2"/m);
    expect(cargo).toMatch(/^flate2 = \{[^}]*features = \[[^\]]*"rust_backend"/m);
  });
});

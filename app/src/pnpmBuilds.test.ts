// 의존성 설치 스크립트 허락 — pnpm 11 은 정하지 않은 빌드 스크립트가 있으면 install 이 실패한다(ERR_PNPM_IGNORED_BUILDS).
// 0.3.0 공개본 깨끗한 설치가 protobufjs 에서 멈췄다(2026-10-15). 정해 둔 값이 있어야 원본·공개본 둘 다 같은 결과
import { describe, expect, it } from 'vitest';
import ws from '../pnpm-workspace.yaml?raw';

describe('pnpm 빌드 스크립트 허락', () => {
  it('protobufjs 는 막는다 — Univer → grpc 가 끌어오는 것, postinstall 은 판 표기 경고만 찍고 앱은 grpc 를 안 쓴다', () => {
    expect(ws).toMatch(/^allowBuilds:\s*$/m);
    expect(ws).toMatch(/^\s+protobufjs:\s*false\s*$/m);
  });

  it('자리표시 값("set this to true or false")이 남아 있지 않다 — pnpm 이 스스로 쓴 파일을 그대로 커밋하면 이게 남는다', () => {
    expect(ws).not.toMatch(/set this to/);
  });
});

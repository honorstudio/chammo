// fetch-conpty.mjs 의 타입(시험 src/buildConfig.test.ts 가 부른다)
export const manifest: { version: string; url: string; sha256: string; files: Record<string, { from: string; sha256: string }> };
export function mismatch(name: string, buf: Uint8Array, want: string): string | null;

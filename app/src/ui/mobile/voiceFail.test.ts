// 음성 모드 단추 — 맥이 답을 못 하면(잠자기·앱 꺼짐) 눌러도 아무 표시 없이 그대로였다(실패를 () => {} 로 삼킴, 폰 QA 10-23).
// 모델 칩 실패와 같은 자리(m-mfail, 7초 뒤 사라짐)에 한 줄
import { describe, expect, it } from 'vitest';
import src from './ComposerExtras.tsx?raw';

const voice = src.slice(src.indexOf('export function VoiceMode'));

describe('음성 모드 단추 실패', () => {
  it('실패를 삼키지 않는다', () => expect(voice).not.toMatch(/setVoiceMode\([^)]*\)\.then\([^;]*,\s*\(\)\s*=>\s*\{\s*\}\)/));
  it("실패하면 '음성 모드를 못 바꿨어요' 한 줄(모델 칩과 같은 m-mfail)", () => {
    expect(voice).toContain("setErr('음성 모드를 못 바꿨어요')");
    expect(voice).toMatch(/\{err && <span className="m-mfail" role="alert">\{err\}<\/span>\}/);
  });
  it('한 줄은 저절로 사라진다', () => expect(voice).toMatch(/setTimeout\(\(\) => setErr\(null\), 7000\)/));
});

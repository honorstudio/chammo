import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';

// 2026-10-22 처음 쓰는 사람 QA 15: 한 앱 안에서 '오케스트레이터'(첫 화면)·'비서'(설정·폰)·'참모'(터미널 뷰)가 섞여
// 같은 걸 넷으로 불렀다. 부르는 이름은 '참모'(영문 assistant) 하나 — 화면에 나가는 글에 옛 이름이 새로 생기면 여기서 걸린다.
// 주석·코드 이름(orchestrator 변수 등)은 상관없다 — 따옴표 안 글만 본다.
const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const noComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');

/** 따옴표('…' "…" `…`) 안 글 — 템플릿의 ${…} 는 그대로 남아도 이름 검사엔 상관없다 */
const literals = (src: string): string[] => [...noComments(src).matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

describe('부르는 이름은 참모 하나', () => {
  it('화면 글에 비서·오케스트레이터가 없다', () => {
    const bad: string[] = [];
    for (const [f, src] of Object.entries(sources)) {
      for (const s of literals(src)) if (/비서|오케스트레이터/.test(s)) bad.push(`${f}: ${s.slice(0, 80)}`);
    }
    expect(bad).toEqual([]);
  });

  it('화면 글(따옴표·JSX 글)에 개발자 개인 참모 이름이 없다 — 공개판 폰 화면에 그대로 떴다(QA 2차)', () => {
    // 옛 기록과 맞추는 안쪽 열쇠(프사 기본 열쇠·옛 참모 이름 읽기)만 예외 — 화면에 안 나간다.
    // 이름은 코드에 적지 않는다 — 공개판 뽑기가 바꾸고 검사가 쪼갠 꼴까지 잡는다(0.3.11 1차). 개발자 맥의 공개판 바꾸기 사전에서
    // '참모'로 바뀌는 이름을 읽고, 사전이 없는 기계(공개판 사용자)에선 볼 이름이 없다
    let names: string[] = [];
    try {
      const m = JSON.parse(readFileSync(`${homedir()}/.claude/.publish-check/redact.json`, 'utf8')) as Record<string, string>;
      names = Object.entries(m).filter(([, v]) => v === '참모').map(([k]) => k);
    } catch { /* 사전 없음 */ }
    for (const NAME of names) {
      const keys = new RegExp(`DEFAULT_KEY = '${NAME}'|LEGACY_ASSISTANT = '${NAME}'`);
      const bad: string[] = [];
      for (const [f, src] of Object.entries(sources)) {
        noComments(src).split('\n').forEach((l, i) => {
          if (l.includes(NAME) && !keys.test(l)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 80)}`);
        });
      }
      expect(bad).toEqual([]);
    }
  });

  it('폰 화면이 가리키는 설정 탭은 지금 이름(폰과 메신저) — 없는 \'모바일\' 탭을 안 가리킨다(QA 2차)', () => {
    const bad: string[] = [];
    for (const [f, src] of Object.entries(sources)) {
      noComments(src).split('\n').forEach((l, i) => {
        if (/설정 (>|&gt;) 모바일/.test(l)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 80)}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('영문 화면 글에 Orchestrator 가 없다(영문은 assistant)', () => {
    const bad: string[] = [];
    for (const [f, src] of Object.entries(sources)) {
      for (const s of literals(src)) if (/\bOrchestrators?\b|\borchestrator home\b/.test(s)) bad.push(`${f}: ${s.slice(0, 80)}`);
    }
    expect(bad).toEqual([]);
  });
});

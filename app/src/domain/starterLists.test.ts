import { describe, expect, it } from 'vitest';
import { starterLists } from './starterLists';

const md = [
  '# starter',
  '## 📍 현재 Phase',
  '- 이건 아님',
  '## 🎯 다음 할 일 — 2026-09-22 갱신',
  '',
  '1. **`npm run build` → 미리보기 한 바퀴** · 배포 전',
  '   - 하위 항목은 뺀다',
  '2. 설명 문서 남음',
  '## 🔄 작업 후 매번 할 일',
  '- 이건 다음 할 일이 아님',
  '## 🧠 최근 결정 (timeline, 위 → 신규)',
  '- **09-28** **목록 화면 개편** — 넓은 배치는 900px 이상만',
  '',
  '- **2026-09-27** 가입은 이메일 확인 뒤',
].join('\n');

describe('starterLists — 프로젝트 대시보드 위 목록(할 일·최근 결정), starter.md 에서(2026-09-30 사용자)', () => {
  it('"다음 할 일"·"최근 결정" 칸의 맨 윗단계 항목만, 굵게·코드 표시는 벗긴다', () => {
    expect(starterLists(md)).toEqual({
      todo: ['npm run build → 미리보기 한 바퀴 · 배포 전', '설명 문서 남음'],
      decisions: ['09-28 목록 화면 개편 — 넓은 배치는 900px 이상만', '2026-09-27 가입은 이메일 확인 뒤'],
    });
  });
  it('"다음 할 일"이 없으면 제목에 "할 일"이 든 첫 칸, 둘 다 없으면 빈 목록', () => {
    expect(starterLists('## 할 일\n- 가\n').todo).toEqual(['가']);
    expect(starterLists('# 아무것도\n')).toEqual({ todo: [], decisions: [] });
  });
});

describe('starterLists — 영어 starter 제목도(공개판 영어 사용자, 0.2.0 검증)', () => {
  it('Next (top 5) · Recent decisions', () => {
    const md = ['## 📍 Current phase', 'x', '## 🎯 Next (top 5)', '- ship it', '- write docs', '## 🧠 Recent decisions', '- chose Tauri'].join('\n');
    expect(starterLists(md)).toEqual({ todo: ['ship it', 'write docs'], decisions: ['chose Tauri'] });
  });
  it('To-do 라고 써도', () => {
    expect(starterLists('## To-do\n- a').todo).toEqual(['a']);
  });
});

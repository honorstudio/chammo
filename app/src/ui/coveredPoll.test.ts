// 팀 모드·다른 기기 참모·기기 보기가 참모 채팅 칸을 덮어도 칸은 붙인 채(터미널 붙임이 안 끊기게) 남는다 —
// 그 밑 ChatView 가 1초마다 기록을, 2초마다 할 일을 읽었다(11-01 perf-bench 가만히: 창이 앞일 때 분당 read_transcript 59·read_session_tasks 42).
// 덮인 동안은 앱 창이 뒤에 있을 때와 같은 길(ui/poll — 5배 느리게, 걷히면 밀린 한 번 바로)로 늦춘다
import { describe, expect, it } from 'vitest';

const src = import.meta.glob(['../App.tsx', './SessionGrid.tsx', './chat/ChatView.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const app = src['../App.tsx'] ?? '';
const grid = src['./SessionGrid.tsx'] ?? '';
const chat = src['./chat/ChatView.tsx'] ?? '';

describe('덮인 참모 채팅은 폴링을 늦춘다', () => {
  it('App 은 팀·원격·기기 보기가 덮을 때 SessionGrid 에 covered 를 넘긴다', () => {
    expect(app).toMatch(/const chatCovered = !!\(teamMode\.chat \|\| remoteChat \|\| farMode\.far\)/);
    expect(app).toMatch(/<SessionGrid column [^\n]*covered=\{chatCovered\}/);
  });
  it('SessionGrid 는 ChatView 에 그대로 넘긴다', () => {
    expect(grid).toMatch(/<ChatView[\s\S]{0,400}covered=\{covered\}/);
  });
  it('ChatView 의 기록·할 일 읽기는 덮임을 아는 주기로', () => {
    expect(chat).toContain('const everyHere = useCoverEvery(covered)');
    expect(chat).toMatch(/return everyHere\(\(\) => void tickRef\.current\?\.\(\), pollMs\)/);
    expect(chat).toMatch(/const stop = everyHere\(tick, 2000\)/);
    expect(chat).not.toMatch(/[^.\w]every\(/);
  });
});

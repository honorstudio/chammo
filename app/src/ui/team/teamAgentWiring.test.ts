// 팀 참모 화면 연결(ADR 0017, 시안 design-v2 섞음 1) — DOM 없이 소스로 지키는 규칙
import { describe, expect, it } from 'vitest';
import edit from './TeamAgentEdit.tsx?raw';
import agents from './TeamAgents.tsx?raw';
import settings from './TeamSettings.tsx?raw';
import convo from './TeamConvo.tsx?raw';
import phone from '../mobile/PhoneTeam.tsx?raw';

describe('팀 참모 화면', () => {
  it('팀 설정 안 칸에서 열고, 고칠 땐 같은 창이 두 칸으로 넓어진다(새 창 없음)', () => {
    expect(settings).toContain('<AgentsSection');
    expect(settings).toContain('tma-wide');
    expect(settings).toContain('<TeamAgentEdit');
  });
  it('머리엔 저장 하나(F5) — 시험은 오른쪽 칸이 늘 있다', () => {
    const head = edit.slice(edit.indexOf('className="tma-eh"'), edit.indexOf('className="tma-panes"'));
    expect(head).toContain("tr('저장', 'Save')");
    expect(head).not.toContain("tr('시험'");
    expect(edit).toContain('api.tryRun(team, room, def, t, prev)');
  });
  it('늘 꺼진 것(명령·쓰기·내 파일·발송)은 고를 칸이 없고 잠금 줄로만 보인다', () => {
    expect(edit).toContain('항상 꺼져 있어요');
    for (const k of ['bash', 'Bash', 'WebFetch', 'write:', 'shell']) expect(edit).not.toContain(k);
  });
  it('화면은 invoke 를 직접 부르지 않는다(teamAgentApi 만)', () => {
    for (const src of [edit, agents]) expect(src).not.toMatch(/invoke\(/);
  });
  it('팀 참모를 부르는 말은 처음·바뀐 판이면 확인 장부터(P2), 이어 묻기는 re 로', () => {
    expect(convo).toContain('needsConfirm(ag, agents!.seen)) { setConfirming(');
    expect(convo).toContain('<AgentConfirm');
    expect(convo).toContain('...(re ? { re } : {})');
  });
  it('토큰은 이 기기 기록(부른 사람)만, 긴 답은 접는다', () => {
    expect(convo).toContain('agentsApi.usage(convo.room)');
    expect(convo).toContain('foldLong(l.text)');
  });
  it('폰은 맥 폰 서버 길로(/api/team-agents·확인·토큰), 이어 묻기 re 도 실어 보낸다', () => {
    expect(phone).toContain('agentsApi={agentsApi}');
    expect(phone).toContain('api.say(to, text, cidFor(to, text), extra?.re)');
  });
  it('폰은 팀 시트 → 팀 참모 화면, 만들기·고치기도 맥 폰 서버 길(서랍 모양 TeamAgentEdit)', () => {
    expect(phone).toContain('onAgents={() => { setSheet(false); setAgentPage({ key: 0 }); }}');
    expect(phone).toContain('api={agentEdit}');
    expect(phone).toContain('load={api.agents}');
  });
});

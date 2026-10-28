// 내 참모 고르기(10-28 사용자) — 보관함 '내 참모에게'·@ 메뉴 '내 참모'·말풍선 넘기기가 한 조각(OrchPick: 프사 + 이름)을 쓴다
import { describe, expect, it } from 'vitest';
import pick from './OrchPick.tsx?raw';
import give from './teamGive.tsx?raw';
import bits from './RoomBits.tsx?raw';
import convo from './TeamConvo.tsx?raw';
import dialogs from '../OrchDialogs.tsx?raw';
import giveDomain from '../../domain/teamGive.ts?raw';

describe('내 참모 고르기 한 조각', () => {
  it('한 줄 = 참모 프사(OrchAvatar) + 이름 — 상태 글(일하는 중·working)은 없다', () => {
    expect(pick).toContain('<OrchAvatar name={o.name || o.label}');
    expect(pick).toContain('<b>{o.label}</b>');
    for (const src of [pick, give, giveDomain]) expect(src).not.toMatch(/· 일하는 중|· working/); // 화면 글(옛 giveLabel 꼬리)
  });
  it('세 곳이 같은 조각 — 보관함 메뉴(node)·@ 메뉴(mine)·넘기기 카드(목록)', () => {
    expect(give).toContain('node: <OrchPickRow o={o} />');
    expect(dialogs).toContain('{it.node ?? it.label}');
    expect(bits).toContain('<OrchPickRow o={m.orch} size={24} />');
    expect(convo).toContain('<OrchPickList list={mine} onPick={handOver}');
  });
  it('어디서 고르든 마지막 고른 참모를 기억해 맨 위에', () => {
    expect(give).toContain('rememberPick(o.id); pick(o);');
    expect(bits.includes('rememberPick') || convo.includes('rememberPick(m.orch.id)')).toBe(true);
    expect(pick).toContain('rememberPick(o.id); onPick(o);');
    expect(pick).toContain('pickOrder(list, last)');
  });
});

describe('대화 속 파일 — 내 참모에게 보내기(보관함과 같은 길·같은 줄)', () => {
  it('파일 말풍선 메뉴에 내 참모에게 → 참모 고르기, 길은 giveIds(team_locker_give)', () => {
    expect(convo).toContain('giveMenu(mine, (o) => void giveIds(f.team || teamId, [f.id], o).catch(fileFail))');
  });
});

describe('@ 메뉴 내 참모 — 그 말은 팀이 아니라 그 참모 입력칸으로', () => {
  it('고른 참모 이름이 글에 남아 있으면 say(팀) 대신 handoff(team_handoff 길)로, 이 칸에서 직접 친 것만', () => {
    const s = convo.slice(convo.indexOf('const sendMine'), convo.indexOf('const send = (checked'));
    expect(s).toContain('handoff.send(body, o.id)');
    expect(s).not.toContain('say(');
    expect(s).toContain('if (!trustedAt.current)');
    expect(convo).toContain('if (o && t.includes(`@${o.label}`)) { sendMine(o, t); return; }');
  });
  it('팀챗엔 나만 보는 줄 — "○○에게 보냄 · 팀엔 안 보임"', () => {
    expect(convo).toContain('에게 보냄 · 팀엔 안 보임');
  });
  it('남의 참모 항목은 메뉴에 없다 — 부르기 목록엔 helper·person·mine 만', () => {
    expect(convo).toContain('mentionList(menu.q, callable, mine, forMention)'); // forMention = 팀이 만든 팀 참모(ADR 0017) — 남의 참모가 아니다
    expect(bits).not.toMatch(/의참모|'s assistant/);
  });
});

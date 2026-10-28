// 팀 메신저 '해결' 다음 '해결해결'(10-28 팀원) — 한글을 치다 Enter 로 보내면 비운 입력칸에 방금 보낸 글이 통째로 되살아나
// 다음 말에 붙어 나갔다. 맥 웹뷰(WebKit)는 조합을 끝내는 Enter 를 compositionend 뒤에 isComposing=false·keyCode 229 로 준다
import { describe, expect, it } from 'vitest';
import { echoOfSent, enterAction } from './enterSend';

const k = (key: string, keyCode: number, isComposing = false, shiftKey = false) => ({ key, keyCode, isComposing, shiftKey });

describe('enterAction — Enter 를 언제 보내나', () => {
  it('보통 Enter 는 바로 보낸다', () => expect(enterAction(k('Enter', 13))).toBe('send'));
  it('입력기가 아직 글을 넣는 중인 Enter(229, WebKit 은 isComposing=false 로 준다)는 다음 차례에', () => expect(enterAction(k('Enter', 229))).toBe('defer'));
  it('조합 중 Enter(크롬·WebView2)는 안 보낸다 — 확정 뒤 Enter 가 따로 온다', () => expect(enterAction(k('Enter', 229, true))).toBe('skip'));
  it('Shift+Enter 는 줄바꿈', () => expect(enterAction(k('Enter', 13, false, true))).toBe('skip'));
  it('다른 키는 상관없다', () => expect(enterAction(k('a', 65))).toBe('skip'));
});

describe('echoOfSent — 보낸 글이 입력칸에 되살아났나', () => {
  const sent = { text: '해결', at: 1000 };
  it('보낸 직후 빈 칸이 보낸 글 통째로 바뀌면 되살아난 것', () => {
    expect(echoOfSent('해결', '', sent, 1100)).toBe(true);
    expect(echoOfSent(' 해결\n', '', sent, 1100)).toBe(true);
  });
  it('사람이 새로 치는 글(한 글자씩 자람)은 아니다', () => {
    expect(echoOfSent('ㅎ', '', sent, 1100)).toBe(false);
    expect(echoOfSent('해', '', sent, 1100)).toBe(false);
    expect(echoOfSent('해결', '해', sent, 1100)).toBe(false);
    expect(echoOfSent('해결해결', '', sent, 1100)).toBe(false);
  });
  it('한 글자 말은 한 번에 쳐도 그 글자라 — 보내고 바로 같은 글자를 쳐도 안 버린다', () => {
    expect(echoOfSent('ㅋ', '', { text: 'ㅋ', at: 1000 }, 1100)).toBe(false);
  });
  it('시간이 지났으면 사람이 같은 말을 다시 친 것', () => expect(echoOfSent('해결', '', sent, 1000 + 1600)).toBe(false));
  it('보낸 게 없으면 아니다', () => expect(echoOfSent('해결', '', null, 1100)).toBe(false));
});

import teamConvo from '../ui/team/TeamConvo.tsx?raw';
import chatView from '../ui/chat/ChatView.tsx?raw';

describe('보내기 칸 연결 — 팀 메신저·참모 채팅', () => {
  it.each([['팀 메신저', teamConvo], ['참모 채팅', chatView]])('%s: Enter 는 enterAction 으로 가르고 229 는 다음 차례, 되살아난 글은 버린다', (_, src) => {
    expect(src).toContain('enterAction({ key: e.key, keyCode: e.keyCode, isComposing: e.nativeEvent.isComposing, shiftKey: e.shiftKey })');
    expect(src).toMatch(/setTimeout\(\(\) => (sendNow|submitNow)\.current\(/);
    expect(src).toMatch(/echoOfSent\(e\.target\.value, (text|draft), lastSent\.current, Date\.now\(\)\)/);
    expect(src).not.toContain("e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {");
  });
});

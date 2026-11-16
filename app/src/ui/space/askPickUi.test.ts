import { describe, expect, it } from 'vitest';
import { askRef, takeRefs, type RefAsk } from '../refBus';
import { areaRef } from '../../domain/askPick';
import askOrch from './AskSelButton.tsx?raw';
import orchCtx from './askOrch.ts?raw';
import editorCss from './editorTone.css?raw';
import editor from './SpaceEditor.tsx?raw';
import spaceView from './SpaceView.tsx?raw';
import chatView from '../chat/ChatView.tsx?raw';
import icons from '../Icons.tsx?raw';
import guideKo from '../../../hq-template/CHAMMO.ko.md?raw';
import guideEn from '../../../hq-template/CHAMMO.md?raw';

// 2026-11-13 사용자: 문서에서 글을 고르면 뜨는 막대에 '참모에게 물어보기', 그림은 상자를 여러 개 골라 묻기 — 지금 보는 참모 입력칸에 칩만, 보내기는 사람이
describe('입력칸에 붙는 길(refBus) — #sel·#area 칩', () => {
  it('at(이름표 뒤 자리)이 받는 입력칸까지 가고, 받은 쪽이 매긴 이름표를 onLabel 로 돌려준다', () => {
    const got: RefAsk[] = [];
    const labels: string[] = [];
    const off = takeRefs('orch-ask', (r) => { got.push(r); r.onLabel?.(`#area${got.length}`); });
    const c = areaRef('/a/shot.png', [0.1, 0.2, 0.3, 0.4]);
    expect(askRef('orch-ask', { ...c, onLabel: (l) => labels.push(l) })).toBe(true);
    expect(got[0]).toMatchObject({ kind: 'area', at: '"/a/shot.png" box=0.1,0.2,0.3,0.4' });
    expect(labels).toEqual(['#area1']);
    off();
  });
  it('채팅 입력칸은 at 을 칩에 싣고, 매긴 이름표를 돌려주고, 커서를 입력칸으로(보내지는 않는다)', () => {
    expect(chatView).toMatch(/if \(!r\.plain\) \{ const label = addRef\(r\.who, r\.text, r\.kind, \{ at: r\.at, head: r\.head \}\); r\.onLabel\?\.\(label\); return; \}/);
    const add = chatView.slice(chatView.indexOf('const addRef = '), chatView.indexOf('const addRefNow'));
    expect(add).toMatch(/\.\.\.\(more\?\.at \? \{ at: more\.at \} : \{\}\), \.\.\.\(more\?\.head \? \{ head: more\.head \} : \{\}\)/);
    expect(add).toMatch(/requestAnimationFrame\(\(\) => input\.current\?\.focus\(\)\)/);
    expect(add).toMatch(/return label;/);
    expect(add).not.toMatch(/submit\(/);
  });
  it('칩 줄·말풍선엔 파일 이름·줄·그림 조각만 — 고른 글·제목은 안 펼친다(11-13 사용자 "텍스트 많은 거 싫어")', () => {
    expect(chatView).toMatch(/title=\{r\.at \? undefined : r\.text\}/);
    expect(chatView).toMatch(/\{r\.at \? <>\{areaOf\(r\.at\) \? <AreaCrop at=\{r\.at\} \/> : null\}<span className="dim q">\{r\.who\}<\/span><\/>/);
    expect(chatView).toMatch(/refs\.filter\(\(r\) => !\/\^\[#@\]sel\\d\+\$\/\.test\(r\.label\)\)\.map\(\(r\) => <div key=\{r\.label\} className="chat-quote"/);
  });
  it('보낸 말풍선의 경로 칸을 누르면 그 줄·상자로 연다(splitPaths at)', () => {
    expect(chatView).toMatch(/openChatFile\(x\.path, by, x\.at\)/);
  });
  it('스페이스가 지금 채팅 탭 참모로 나른다 — 루트를 감싸 사무실 위 창·살려 둔 문서도 받는다', () => {
    expect(spaceView).toMatch(/askRef\(chatOrch\.id, \{ \.\.\.c, \.\.\.\(onLabel \?/);
    expect(spaceView).toMatch(/<AskOrchContext\.Provider value=\{askOrch\}>\s*<div className="space cv">\s*\{keep\.host\(\)\}/);
  });
});

describe('문서 선택 막대 — 물어보기', () => {
  it('기본 막대는 끄고 기본 단추 + 끝에 물어보기(내 메모엔 없음)', () => {
    expect(editor).toMatch(/formattingToolbar=\{false\}/);
    expect(editor).toMatch(/<FormattingToolbar>\{getFormattingToolbarItems\(\)\}\{!personal && <AskSelButton key="ask" docPath=\{docPath\} \/>\}<\/FormattingToolbar>/);
  });
  it('아이콘은 머리의 참모에게 보내기와 같은 IconChatSend + 이름은 짧게 하나(label·mainTooltip), 둘째 줄 설명 없음, 글을 골랐을 때만', () => {
    expect(askOrch).not.toMatch(/secondaryTooltip/);
    expect(orchCtx).toMatch(/export const askLabel = \(_to\?: OrchTo \| null\) => tr\('물어보기', 'Ask'\);/);
    expect(askOrch).toMatch(/<Components\.FormattingToolbar\.Button className="bn-button doc-ask" label=\{label\} mainTooltip=\{label\}/);
    expect(askOrch).toMatch(/icon=\{<span className="doc-ask-ico"[^\n]*<IconChatSend \/><\/span>\}/);
    expect(askOrch).toMatch(/if \(!orch \|\| !has\) return null;/);
    expect(askOrch).not.toMatch(/lucide|react-icons/);
  });
  it('줄은 디스크 원본으로 센다 — 고른 글·앞 글은 같은 꼴(블록 사이·문단 안 줄바꿈 둘 다 \\n)', () => {
    expect(askOrch).toMatch(/doc\.textBetween\(selection\.from, selection\.to, '\\n', '\\n'\)/);
    expect(askOrch).toMatch(/doc\.textBetween\(0, selection\.from, '\\n', '\\n'\)/);
    // 막대를 닫아야 커서가 입력칸에 남는다(막대 포커스 관리자가 되가져간다)
    expect(askOrch).toMatch(/_tiptapEditor\.commands\.setTextSelection\(selection\.to\)/);
    expect(askOrch).toMatch(/invoke<string>\('read_doc_text', \{ path: docPath \}\)\.catch\(\(\) => ''\)\.then\(\(src\) => orch\.ask\(\[selRef\(docPath, src, picked, before\)\]\)\)/);
  });
  it('막대 끝 칸은 참모 색 면, 앞 단추와는 곧은 1px 줄(왼쪽 색 띠 아님)', () => {
    expect(editorCss).toMatch(/\.doc-ask-ico \{[^}]*background: var\(--orch-solid, var\(--accent\)\)/);
    expect(editorCss).toMatch(/\.doc-ask::before \{[^}]*width: 1px; background: var\(--line\)/);
    expect(editorCss).not.toMatch(/border-left:\s*\d/);
  });
  it('물어보기 아이콘을 따로 그리지 않는다 — 기존 IconChatSend, 막대 칸도 머리 보내기 단추(kit-ib-m 28px·7px·아이콘 15px)와 같게(11-13 사용자 "아이콘 통일")', () => {
    expect(icons).not.toMatch(/IconAsk/);
    expect(editorCss).toMatch(/\.doc-ask-ico \{[^}]*width: 28px; height: 28px; border-radius: 7px;/);
    expect(editorCss).toMatch(/\.doc-ask-ico svg \{ width: 15px; height: 15px; \}/);
  });
});

describe('참모 안내문 — 받는 쪽이 칩을 읽는 법', () => {
  it('한글·영문 둘 다 #sel "파일:줄" 과 #area "그림" box=x,y,w,h(0~1), 짚기는 scripts/show 같은 값', () => {
    for (const g of [guideKo, guideEn]) {
      expect(g).toMatch(/`#sel1 "<[^>]+>:<[^>]+>"`/);
      expect(g).toMatch(/`#area1 "<[^>]+>" box=x,y,w,h`/);
      expect(g).toMatch(/\[참조 #sel1 · /);
      expect(g).toMatch(/scripts\/show "<[^>]+>:<[^>]+>"`[^\n]*`--box x,y,w,h`/);
    }
  });
});

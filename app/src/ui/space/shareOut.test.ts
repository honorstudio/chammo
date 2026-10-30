import { describe, expect, it } from 'vitest';
import tab from './FileTab.tsx?raw';
import card from '../chat/ChatFileCard.tsx?raw';
import modal from './Preview.tsx?raw';
import chatCss from '../chat/chat.css?raw';
import icons from '../Icons.tsx?raw';
import reveal from '../../../src-tauri/src/locker_fs.rs?raw';

// 2026-10-30 — 보여 준 그림을 남에게 주려 한다: 파인더에서 열거나, 띄운 그대로 끌어서 넘기고 싶다
// 파인더에서 보기 = 보관함의 locker_reveal 그대로(보관함 밖은 보여 준 파일만 — shown_share), 끌기 = dragOut(창 밖이면 맥 끌기 drag_native)
const bar = tab.slice(tab.indexOf('cv-doc-bar'), tab.indexOf('ft-body'));

describe('스페이스 미리보기 머리줄', () => {
  it("'파인더에서 보기' 아이콘 단추 — 글자 단추가 아니라 IconReveal + 이름(aria-label·title)", () => {
    expect(bar).toMatch(/<IconButton label=\{tr\('파인더에서 보기', 'Show in Finder'\)\}.*?><IconReveal \/><\/IconButton>/);
    expect(icons).toMatch(/export const IconReveal = \(\) =>/);
  });
  it('누르면 보관함과 같은 locker_reveal(lockerApi.reveal) — 팀 파일(데이터 폴더 평문)엔 안 단다(내려받기 몫)', () => {
    expect(bar).toMatch(/lockerApi\.reveal\(path\)/);
    expect(bar).toMatch(/\{!isTeamCache\(path\) && <IconButton label=\{tr\('파인더에서 보기'/);
  });
  it('경로 줄을 끌면 바깥으로(dragOut) — 그림도 칸이 안 넘칠 때(넘치면 끌어서 이동 몫)', () => {
    expect(bar).toMatch(/className="cv-path"[^>]*\{\.\.\.dragOut\(path\)\}/);
    expect(tab).toMatch(/onPointerDown=\{imgOut\}/);
    expect(tab).toMatch(/scrollWidth > b\.clientWidth \+ 1/);
  });
});

describe('크게 보기(모달) 머리줄 — 참모 없이 show 로 떠도 같다', () => {
  const head = modal.slice(modal.indexOf('<div className="bar"'), modal.indexOf('{askSend &&'));
  it('파일 이름을 끌면 바깥으로(dragOut) — 주소·붙인 그림은 아님', () => {
    expect(head).toMatch(/<b \{\.\.\.\(file \? dragOut\(f\.path\) : \{\}\)\}/);
  });
  it("'파인더에서 보기' 아이콘 단추 — 같은 lockerApi.reveal", () => {
    expect(head).toMatch(/\{file && <button className="pv-ic" onClick=\{\(\) => void lockerApi\.reveal\(f\.path\)\.catch\(\(\) => \{\}\)\}[^>]*aria-label=\{tr\('파인더에서 보기', 'Show in Finder'\)\}><IconReveal \/><\/button>\}/);
  });
});

describe('채팅 파일 카드', () => {
  it('끌면 바깥으로(dragOut)', () => {
    expect(card).toMatch(/\{\.\.\.dragOut\(f\.path\)\}/);
  });
  it("오른쪽 클릭 메뉴에 '파인더에서 보기' — 보관함 메뉴와 같은 글·같은 명령", () => {
    expect(card).toMatch(/onContextMenu=/);
    expect(card).toMatch(/tr\('파인더에서 보기', 'Show in Finder'\)/);
    expect(card).toMatch(/lockerApi\.reveal\(f\.path\)/);
  });
  it('썸네일은 웹뷰 그림 끌기를 안 시작한다(우리 끌기를 가로채 pointercancel)', () => {
    expect(chatCss).toMatch(/\.chat-filecard img \{[^}]*-webkit-user-drag: none/);
  });
});

describe('Rust locker_reveal — 보관함 밖은 보여 준 파일만', () => {
  it('in_root_ro 가 안 되면 shown_now 거름을 지난 것만 연다(아무 경로나 아님)', () => {
    const fn = reveal.slice(reveal.indexOf('pub fn locker_reveal'), reveal.indexOf('pub async fn locker_choose'));
    expect(fn).toMatch(/Err\(_\) if crate::shown_share::shown_now\(&path\) =>/);
    expect(fn).toMatch(/Err\(e\) => return Err\(e\)/);
  });
});

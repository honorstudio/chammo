import { describe, expect, it } from 'vitest';
import reader from './reader/Reader.tsx?raw';
import follow from './followLink.ts?raw';
import space from './space/SpaceView.tsx?raw';
import sheet from './mobile/HtmlSheet.tsx?raw';
import rust from '../../src-tauri/src/agent_browser.rs?raw';
import main from '../../src-tauri/src/main.rs?raw';
import guard from './frameGuard.ts?raw';
import fileTab from './space/FileTab.tsx?raw';
import open from './space/openLink.ts?raw';
import nav from '../../src-tauri/src/frame_nav.rs?raw';
import editor from './space/SpaceEditor.tsx?raw';

// 2026-11-05 사용자 — 시안 칸 링크 다리({hodoc:'link'})가 앱 끝까지 이어지는지: 칸 → HtmlFrame → openFrameLink → SpaceView __openLink → agent_open_tab → 브라우저 칸
describe('시안 칸 링크 연결', () => {
  it('HtmlFrame 은 자기 칸이 보낸 것만 다시 걸러 넘긴다', () => {
    const f = reader.slice(reader.indexOf('export function HtmlFrame'));
    expect(f).toMatch(/e\.source !== f\.contentWindow\) return;\s*const url = frameLink\(e\.data\);\s*if \(url\) openFrameLink\(url, pathOfDocUrl\(src\) \?\? '', f\);/);
  });
  it('openFrameLink — 스페이스가 받으면 거기, 아니면 기본 브라우저', () => {
    const f = follow.slice(follow.indexOf('export function openFrameLink'));
    expect(f).toMatch(/if \(w\.__openLink\?\.\(url, doc, frame\)\) return;\s*void openTarget\('url', url\)/);
  });
  it('SpaceView — 스페이스·미리보기 칸만, 프로젝트 세션 브라우저 또는 참모 브라우저 새 탭 → 그 브라우저 칸', () => {
    const f = space.slice(space.indexOf('w.__openLink = '));
    expect(f).toMatch(/frame\.closest\('\.space, \.dash-preview'\)\) return false;/);
    expect(f).toMatch(/void openLinkIn\(url, doc, \{\s*held,/);
    expect(f).toMatch(/setModal\(null\);\s*setPick\(browserKey\(p\), 'browser'\);/);
    expect(f).toMatch(/fail: \(e\) => \{[^\n]*void openTarget\('url', url\)/);
    expect(open).toMatch(/linkBrowser\(doc, d\.held, root\)/);
    expect(open).toMatch(/invoke\('agent_open_tab', \{ profile: p, url \}\)\.then\(\(\) => d\.shown\(p\)\)/);
    expect(open).toMatch(/invoke<string>\('hq_browser_open'\)\.then\(\(p\) => \{ d\.hqOpened\(p\); return show\(p\); \}\)/);
    expect(f).toMatch(/delete w\.__openLink/);
  });
  it('Rust — 웹 주소만 새 탭, 칸이 그 탭을 보게, 등록됨', () => {
    const f = rust.slice(rust.indexOf('pub fn agent_open_tab'));
    expect(f.slice(0, 700)).toMatch(/open_tab_params\(&url\)/);
    expect(f.slice(0, 700)).toMatch(/Target\.createTarget/);
    expect(f.slice(0, 900)).toMatch(/\.pinned = Some\(id\.clone\(\)\)/);
    expect(main).toMatch(/agent_browser::agent_open_tab,/);
  });
  it('폰 — 폰 브라우저 새 창(noopener)', () => {
    expect(sheet).toMatch(/const link = frameLink\(d\);\s*if \(link\) window\.open\(link, '_blank', 'noopener,noreferrer'\);/);
  });
  it('칸 지킴이 — 맥 HtmlFrame·폰 HtmlSheet 가 load 를 넘기고, 비면 다시 불러오기 아이콘', () => {
    const f = reader.slice(reader.indexOf('export function HtmlFrame'));
    expect(f).toMatch(/const guard = useFrameGuard\(ref, src\);/);
    expect(f).toMatch(/guard\.onLoad\(\); onLoad\?\.\(\);/);
    expect(f).toMatch(/\{guard\.gone && <IconButton[^\n]*onClick=\{guard\.reload\}><IconRefresh \/>/);
    expect(sheet).toMatch(/const guard = useFrameGuard\(frame, url \?\? ''\);/);
    expect(sheet).toMatch(/onLoad=\{guard\.onLoad\}/);
    expect(sheet).toMatch(/guard\.gone && <button[^\n]*onClick=\{guard\.reload\}/);
    expect(guard).toMatch(/e\.source !== w\) return;/);
    expect(guard).toMatch(/if \(r\.reset\) ref\.current\?\.setAttribute\('src', src\);/);
  });
  it('스페이스 html 탭 머리 — 다시 불러오기 아이콘(늘)', () => {
    expect(fileTab).toMatch(/kind === 'html' && <IconButton label=\{tr\('다시 불러오기', 'Reload'\)\} onClick=\{\(\) => setReload\(\(n\) => n \+ 1\)\}><IconRefresh \/>/);
    expect(fileTab).toMatch(/className="ft-body" key=\{`\$\{stamp \?\? ''\}:\$\{reload\}`\}/);
  });
  it('웹뷰가 막은 칸 이동(frame_nav) — 플러그인 등록, 화면은 포커스된 칸만 연다', () => {
    expect(main).toMatch(/\.plugin\(frame_nav::plugin\(\)\)/);
    expect(nav).toMatch(/if !blocks\(wv\.label\(\), url\) \{\s*return true;\s*\}\s*let _ = wv\.eval\(call_js\(url\.as_str\(\)\)\);\s*false/);
    expect(follow).toMatch(/if \(url && f instanceof HTMLIFrameElement\) openFrameLink\(url, pathOfDocUrl\(f\.src\) \?\? '', f\);/);
    expect(follow).toMatch(/if \(typeof window !== 'undefined'\) watchFrameNav\(\);/);
  });
  it('스페이스 md 문서 링크 단추(window.open) — 웹 주소면 같은 길', () => {
    expect(editor).toMatch(/const web = url \? frameLink\(\{ hodoc: 'link', url: String\(url\) \}\) : null;\s*if \(web\) \{ openFrameLink\(web, '', document\.querySelector\('\.space'\) \?\? document\.body\); return null; \}/);
  });
});

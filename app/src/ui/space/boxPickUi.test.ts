import { describe, expect, it } from 'vitest';
import boxPick from './BoxPick.tsx?raw';
import boxCss from './boxPick.css?raw';
import fileTab from './FileTab.tsx?raw';
import icons from '../Icons.tsx?raw';

// 2026-11-13 사용자: 그림은 고르는 기능이 아예 없다 — 상자를 여러 개 골라 그 자리를 짚은 채 참모에게 묻기(BoxPick)
describe('그림 영역 고르기 — 상자 여러 개 → 물어보기', () => {
  it('영역 고르기만 새 아이콘 — 기존 아이콘과 같은 16칸·같은 선(P), 지우기·다 지우기는 기존 IconClose·IconTrash', () => {
    expect(icons).toMatch(/export const IconBoxPick = \(\) => \(\s*<svg viewBox="0 0 16 16" \{\.\.\.P\}>/);
    expect(boxPick).toMatch(/import \{ IconChatSend, IconClose, IconTrash \} from '\.\.\/Icons';/);
  });
  it('머리 토글은 그림이고 받을 참모가 있을 때만, 끄면 상자도 지운다', () => {
    expect(fileTab).toMatch(/\{kind === 'image' && pick\.can && <IconButton pressed=\{picking\} label=\{tr\('영역 고르기', 'Pick areas'\)\}/);
    expect(fileTab).toMatch(/useBoxPick\(imgBox, path, picking && kind === 'image'\)/);
    expect(boxPick).toMatch(/useEffect\(\(\) => \{ if \(!on\) \{ setBoxes\(\[\]\); setLive\(null\); \} \}, \[on\]\)/);
  });
  it('상자 층은 그림 칸(스크롤) 안, 막대는 칸 밖 — 그림을 굴려도 막대는 제자리', () => {
    expect(fileTab).toMatch(/<span className="pv-box" style=\{boxAt\} \/>\}\{pick\.layer\}<\/div>/);
    expect(fileTab).toMatch(/%<\/span>\}\{pick\.bar\}<\/>/);
  });
  it('긋기는 층에 직접 단 귀에서 멈춘다 — 칸의 그림 이동·바깥 끌기·두 번 눌러 확대로 안 올라가게', () => {
    const down = boxPick.slice(boxPick.indexOf('const down = '), boxPick.indexOf('const move = '));
    expect(down).toMatch(/e\.stopPropagation\(\);/);
    expect(down).toMatch(/el\.setPointerCapture\(e\.pointerId\)/);
    expect(boxPick).toMatch(/el\.addEventListener\('dblclick', stop\)/);
    expect(boxPick).toMatch(/el\.addEventListener\('pointercancel', end\)/);
  });
  it('물어보기는 아직 안 물은 상자만 #area 칩으로, 받은 이름표로 번호를 바꾼다', () => {
    expect(boxPick).toMatch(/orch\.ask\(idx\.map\(\(i\) => areaRef\(path, boxes\[i\]!\.box\)\), \(k, label\) => setBoxes/);
    expect(boxPick).toMatch(/const todo = boxes\.flatMap\(\(b, i\) => \(b\.label \? \[\] : \[i\]\)\)/);
  });
  it('상자마다 지우기·다 지우기 — 아이콘만, 이름은 짧게 하나(설명 title 없음)', () => {
    expect(boxPick).toMatch(/className="bx-x" aria-label=\{tr\('지우기', 'Remove'\)\} title=\{tr\('지우기', 'Remove'\)\}/);
    expect(boxPick).toMatch(/<IconButton label=\{tr\('다 지우기', 'Clear all'\)\} onClick=\{\(\) => setBoxes\(\[\]\)\}><IconTrash \/><\/IconButton>/);
    expect(boxPick).toMatch(/<IconButton className="send-orch" label=\{askLabel\(orch\.to\)\} disabled=\{!todo\.length\} onClick=\{ask\}><IconChatSend \/><\/IconButton>/);
    expect(boxPick).not.toMatch(/ title=\{tr\(`/);
    expect(fileTab).toMatch(/<IconButton pressed=\{picking\} label=\{tr\('영역 고르기', 'Pick areas'\)\} onClick=/);
  });
  it('상자는 전체 테두리(안 물음 점선·물음 실선), 층은 --z-* 변수, 왼쪽 색 띠 없음', () => {
    expect(boxCss).toMatch(/\.bx-box \{[^}]*border: 2px dashed var\(--orch-solid/);
    expect(boxCss).toMatch(/\.bx-box\.bx-sent \{ border-style: solid; \}/);
    expect(boxCss).toMatch(/z-index: calc\(var\(--z-base\) \+ 2\)/);
    expect(boxCss).not.toMatch(/border-left:\s*\d|z-index:\s*\d/);
  });
});

describe('입력칸 #area 칩 — 숫자 대신 그 상자 부분 그림', () => {
  it('칩 줄은 #area 면 AreaCrop(상자 부분) + 파일 이름만, box= 숫자는 안 그린다', async () => {
    const chat = (await import('../chat/ChatView.tsx?raw')).default;
    // 이름 칸이 남은 폭을 먹어 빼기(×)가 오른쪽 끝에 남는다
    expect(chat).toMatch(/\{r\.at \? <>\{areaOf\(r\.at\) \? <AreaCrop at=\{r\.at\} \/> : null\}<span className="dim q">\{r\.who\}<\/span><\/> : <><span className="dim">\{r\.who\}<\/span><span className="q">/);
    // 보낸 말풍선도 #area 칸은 파일 이름(세 번 되풀이) 대신 그 상자 부분 그림 — 누르면 그 상자로 연다
    expect(chat).toMatch(/\{x\.at\?\.box \? <AreaCrop path=\{x\.path\} box=\{x\.at\.box\} height=\{18\} \/> : <><IconFile \/>\{x\.name\}<\/>\}/);
    const crop = (await import('../chat/AreaCrop.tsx?raw')).default;
    expect(crop).toMatch(/cropOf\(a\.box, nat, height\)/);
    expect(crop).toMatch(/aria-hidden/);
  });
});

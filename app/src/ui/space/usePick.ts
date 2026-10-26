// 파인더식 고르기 — 참모 보관함(LockerPage)과 팀 보관함(TeamLocker)이 같이 쓴다(10-26 사용자 "보관함이랑 성격이 다르네").
// ⌘클릭 = 넣고 빼기, ⇧클릭 = 범위, 빈 곳 끌기 = 네모(⌘ = 넣고 빼기, 끝에 닿으면 저절로 스크롤), ⌘A = 보이는 것 전부(ui/selectAll), 빈 곳 클릭 = 풀기,
// 우클릭 = 고른 묶음 밖이면 그 하나. 판단은 domain/lockerSelect, 여기는 사건·그리기만. 열쇠·순서는 화면이 준다(보이는 순서)
import { useEffect, useRef, useState } from 'react';
import { bandBox, bandHits, edgeScroll, NO_SEL, pickAll, pickBand, pickClick, pickKeep, pickOne, type Sel } from '../../domain/lockerSelect';
import { areaSelectAll } from '../selectAll';
import { lostRelease } from './dragEnd';

type Band = { left: number; top: number; width: number; height: number };

/** box = 고르는 칸(스크롤되는 상자, tabIndex -1 · data-select-all) · order = 보이는 열쇠 순서 · reset = 바뀌면 풀린다(다른 자리) ·
 *  skip = 네모 끌기를 시작하지 않을 자리(카드·단추·입력칸…) · touch = 고른 게 바뀔 때마다(묻던 것 닫기 등) */
export function usePick({ box, order, reset, skip, touch }: { box: React.RefObject<HTMLElement | null>; order: string[]; reset: string; skip: string; touch?: () => void }) {
  const [sel, setSel] = useState<Sel>(NO_SEL);
  const [band, setBand] = useState<Band | null>(null);
  const touchRef = useRef(touch);
  touchRef.current = touch;
  const end = () => { setSel(NO_SEL); touchRef.current?.(); };
  useEffect(end, [reset]); // eslint-disable-line react-hooks/exhaustive-deps
  const orderKey = order.join('\n');
  useEffect(() => setSel((x) => pickKeep(x, order)), [orderKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘A — 앱 단축키(ui/selectAll)가 포커스가 이 칸 안이면 이리 넘긴다
  const allRef = useRef(() => {});
  allRef.current = () => { if (order.length) { setSel(pickAll(order)); touchRef.current?.(); } };
  useEffect(() => {
    const el = box.current;
    if (el) areaSelectAll.set(el, () => allRef.current());
  });
  /** 카드·줄 누름 — ⌘·⇧ 누름을 고르기로 받았으면 true(그러면 열지 않는다). 그냥 누름 = 열기(고른 건 풀린다) */
  const press = (x: React.MouseEvent, key: string) => {
    const n = pickClick(sel, order, key, { meta: x.metaKey, shift: x.shiftKey });
    if (!n) { if (sel.keys.length) end(); return false; }
    x.preventDefault(); setSel(n); touchRef.current?.();
    box.current?.focus({ preventScroll: true }); // 웹킷은 단추를 눌러도 포커스를 안 옮긴다 — 채팅 입력칸에 남으면 Backspace·Esc 가 여기 안 온다
    return true;
  };
  /** 우클릭 — 고른 묶음 밖이면 그 하나만 고른다(고를 수 있는 자리에서만) */
  const right = (key: string) => { if (order.includes(key)) { setSel((x) => pickOne(x, key)); touchRef.current?.(); box.current?.focus({ preventScroll: true }); } };
  const picked = (key: string) => sel.keys.includes(key);
  /** 고른 묶음 안의 하나인가(둘 이상 고른 채) — 끌기·우클릭이 묶음째 */
  const many = (key: string) => sel.keys.length > 1 && sel.keys.includes(key);
  // 빈 곳에서 끌기 = 네모 선택(⌘ = 넣고 빼기). 카드·줄·단추 위에서 시작하면 그쪽 끌기·누름. 안 움직이고 놓으면 = 빈 곳 클릭(풀기)
  const bandStart = (e: React.PointerEvent) => {
    const wrap = box.current;
    if (!wrap || e.button !== 0 || e.ctrlKey || (e.target as HTMLElement).closest(skip)) return;
    if (e.clientX > wrap.getBoundingClientRect().right - (wrap.offsetWidth - wrap.clientWidth)) return; // 스크롤 막대
    const toggle = e.metaKey;
    const base = toggle ? sel : NO_SEL;
    const at = (cx: number, cy: number) => { const r = wrap.getBoundingClientRect(); return { x: cx - r.left + wrap.scrollLeft, y: cy - r.top + wrap.scrollTop }; };
    const p0 = at(e.clientX, e.clientY);
    let last = { x: e.clientX, y: e.clientY };
    let moved = false;
    let raf = 0;
    const lost = lostRelease(() => finish());
    const draw = () => {
      const p1 = at(last.x, last.y);
      const b = bandBox(p0.x, p0.y, p1.x, p1.y);
      setBand({ left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top });
      const r = wrap.getBoundingClientRect();
      const items = [...wrap.querySelectorAll<HTMLElement>('[data-pick]')].map((el) => {
        const q = el.getBoundingClientRect();
        return { key: el.dataset.pick!, box: { left: q.left - r.left + wrap.scrollLeft, top: q.top - r.top + wrap.scrollTop, right: q.right - r.left + wrap.scrollLeft, bottom: q.bottom - r.top + wrap.scrollTop } };
      });
      setSel(pickBand(base, bandHits(b, items), toggle));
    };
    const tick = () => {
      const r = wrap.getBoundingClientRect();
      const dy = edgeScroll(last.y, r.top, r.bottom);
      if (dy) { const before = wrap.scrollTop; wrap.scrollTop += dy; if (wrap.scrollTop !== before) draw(); }
      raf = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      lost.move(ev.buttons); // 버튼 0 이어도 바로 끝내지 않는다 — 뗀 뒤에 처리된 끌기 사건일 수 있다(dragEnd)
      last = { x: ev.clientX, y: ev.clientY };
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      if (!moved) { moved = true; touchRef.current?.(); raf = requestAnimationFrame(tick); }
      draw();
    };
    const finish = () => {
      lost.stop();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      cancelAnimationFrame(raf);
      setBand(null);
      if (!moved && !toggle) end(); // 빈 곳 클릭 = 풀기
    };
    e.preventDefault(); // 글자 긁기 대신 네모
    wrap.focus({ preventScroll: true }); // 막은 누름은 포커스도 안 옮긴다 — 채팅 입력칸에 남으면 ⌘A·Esc 가 여기 안 온다
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  };
  // ⇧클릭이 글자를 긁지 않게
  const noShiftSelect = (x: React.MouseEvent) => { if (x.shiftKey && (x.target as HTMLElement).closest('[data-pick]')) x.preventDefault(); };
  return { sel, setSel, end, press, right, picked, many, bandStart, band, noShiftSelect };
}

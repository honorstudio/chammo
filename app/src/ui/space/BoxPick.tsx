// 그림에서 영역 고르기 → 참모에게 물어보기(2026-11-13 사용자 "그림은 이런 기능이 아예 없다 — 상자로 여러 군데 골라 묻고 싶다").
// 머리 '영역 고르기'를 켜면 그림 위를 끌어 상자를 여러 개 긋는다(번호 표시, 상자마다 지우기). 아래 막대 = 물어보기·다 지우기.
// 물어보면 상자마다 #area 칩이 지금 채팅 탭 참모 입력칸에 붙고(보내기는 사람이), 상자 번호가 받은 칩 번호로 바뀐다
import { useEffect, useRef, useState, type RefObject } from 'react';
import { areaRef, boxOf, boxPx, type Box, type Rect } from '../../domain/askPick';
import { orchVars } from '../../domain/orchTheme';
import { tr } from '../../i18n';
import { IconChatSend, IconClose, IconTrash } from '../Icons';
import { IconButton } from '../kit/IconButton';
import { askLabel, useAskOrch } from './askOrch';
import './boxPick.css';

/** 고른 상자 — label = 받은 칩 이름표(#area2), 아직 안 물었으면 없음 */
type Picked = { box: Box; label?: string };

const at0 = (img: HTMLImageElement): Rect => ({ left: 0, top: 0, width: img.offsetWidth, height: img.offsetHeight });

/** layer = 그림 칸(.pv-image, 스크롤) 안에 · bar = 칸 밖(.ft-body)에 — 막대는 그림을 굴려도 제자리 */
export function useBoxPick(imgBox: RefObject<HTMLDivElement | null>, path: string, on: boolean): { layer: React.ReactNode; bar: React.ReactNode; can: boolean } {
  const orch = useAskOrch();
  const [boxes, setBoxes] = useState<Picked[]>([]);
  const [live, setLive] = useState<Box | null>(null);
  const [, redraw] = useState(0);
  const layer = useRef<HTMLDivElement>(null);
  const img = on ? imgBox.current?.querySelector('img') ?? null : null;
  // 끄면 다 지운다(다시 켜면 새로 고르기)
  useEffect(() => { if (!on) { setBoxes([]); setLive(null); } }, [on]);
  // 그림 크기가 바뀌면(맞춤·확대·칸 넓이) 상자 자리를 다시 — 비율로 들고 있어서 그리기만 다시
  useEffect(() => {
    const el = imgBox.current?.querySelector('img');
    if (!on || !el) return;
    const ro = new ResizeObserver(() => redraw((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  // 끌어 긋기 — 그림 위 층에 직접 단 귀. 칸에 단 그림 이동(useImagePan)·바깥 끌기·두 번 눌러 확대로 안 올라가게 여기서 멈춘다
  useEffect(() => {
    const el = layer.current;
    const pic = imgBox.current?.querySelector('img');
    if (!on || !el || !pic) return;
    let from: { x: number; y: number } | null = null;
    const rect = (): Rect => { const r = pic.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const down = (e: PointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0 || (e.target as Element).closest('.bx-x')) return;
      e.preventDefault();
      from = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => { if (from) { e.stopPropagation(); setLive(boxOf(from, { x: e.clientX, y: e.clientY }, rect())); } };
    const end = (e: PointerEvent) => {
      if (!from) return;
      e.stopPropagation();
      const b = e.type === 'pointerup' ? boxOf(from, { x: e.clientX, y: e.clientY }, rect()) : null;
      from = null;
      setLive(null);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (b) setBoxes((bs) => [...bs, { box: b }]);
    };
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', stop);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('dblclick', stop);
    };
  }, [on, !!img]); // eslint-disable-line react-hooks/exhaustive-deps

  const todo = boxes.flatMap((b, i) => (b.label ? [] : [i]));
  // 번호 — 물은 상자는 받은 칩 번호, 아직이면 그 뒤로 이어서(물으면 대개 그 번호로 붙는다)
  const top = Math.max(0, ...boxes.map((b) => Number(b.label?.replace(/^#area/, '')) || 0));
  const num = (i: number) => boxes[i]!.label?.replace(/^#area/, '') ?? String(top + todo.indexOf(i) + 1);
  const ask = () => {
    if (!orch || !todo.length) return;
    const idx = [...todo];
    orch.ask(idx.map((i) => areaRef(path, boxes[i]!.box)), (k, label) => setBoxes((bs) => bs.map((b, j) => (j === idx[k] ? { ...b, label } : b))));
  };
  const tint = orch?.to ? (orchVars(orch.to.color) as React.CSSProperties) : undefined;
  const r = img ? at0(img) : null;
  return {
    can: !!orch,
    layer: on && img && r ? (
      <div className="bx-layer" ref={layer} style={{ left: img.offsetLeft, top: img.offsetTop, width: r.width, height: r.height, ...tint }}>
        {boxes.map((b, i) => (
          <div key={i} className={b.label ? 'bx-box bx-sent' : 'bx-box'} style={boxPx(b.box, r)}>
            <span className="bx-num">{num(i)}</span>
            <button type="button" className="bx-x" aria-label={tr('지우기', 'Remove')} title={tr('지우기', 'Remove')}
              onClick={() => setBoxes((bs) => bs.filter((_, j) => j !== i))}><IconClose /></button>
          </div>
        ))}
        {live && <div className="bx-box bx-live" style={boxPx(live, r)} />}
      </div>
    ) : null,
    bar: on && orch && boxes.length ? (
      <div className="bx-bar" style={tint}>
        <IconButton className="send-orch" label={askLabel(orch.to)} disabled={!todo.length} onClick={ask}><IconChatSend /></IconButton>
        <IconButton label={tr('다 지우기', 'Clear all')} onClick={() => setBoxes([])}><IconTrash /></IconButton>
      </div>
    ) : null,
  };
}

// 셸 탭 살려 두기 — 참모·홈·다른 탭으로 옮겨도 셸이 안 죽게(창이 사라지면 pty 를 닫는다). docKeep 과 같은 꼴:
// 셸마다 떨어진 상자 하나에 터미널을 포털로 그려 두고, 그 셸 탭을 볼 때만 상자를 자리(DocSlot)에 붙인다.
// 떨어진 동안 터미널은 크기 0 이라 칸 수를 안 바꾼다(FitAddon 이 잴 게 없어 그대로) — 다시 붙으면 ResizeObserver 가 다시 잰다
import { useRef, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { TerminalPane, type PaneApi } from '../TerminalPane';
import { DocSlot } from './docKeep';
import type { ShellTab } from '../../domain/shellTab';

export function useShellKeep() {
  const boxes = useRef(new Map<string, HTMLDivElement>());
  const apis = useRef(new Map<string, PaneApi>());
  const boxOf = (key: string) => {
    let b = boxes.current.get(key);
    if (!b) { b = Object.assign(document.createElement('div'), { className: 'cv-keep-box shell-box' }); boxes.current.set(key, b); }
    return b;
  };
  return {
    api: (key: string) => apis.current.get(key) ?? null,
    /** 셸 탭 화면 자리 */
    slot: (key: string): ReactElement => <DocSlot key={key} box={boxOf(key)} />,
    /** SpaceView 맨 위에 늘 — 열린 셸 전부. 닫힌 셸(목록에서 빠짐)은 상자도 버린다(TerminalPane 정리가 pty 를 닫는다 = 셸 끝) */
    host(shells: ShellTab[], opt: { fontSize: number; home?: string; onExit: (key: string) => void; onFocus?: (key: string) => void }): ReactElement {
      const keep = new Set(shells.map((s) => s.key));
      for (const k of [...boxes.current.keys()]) if (!keep.has(k)) { boxes.current.get(k)?.remove(); boxes.current.delete(k); apis.current.delete(k); }
      return (
        <>
          {shells.map((s) => createPortal(
            <TerminalPane shell command="" cwd={s.cwd} title={s.title} fontSize={opt.fontSize} linkBase={s.cwd} home={opt.home} headless autoFocus
              inject={(a) => { if (a) apis.current.set(s.key, a); else apis.current.delete(s.key); }}
              onFocus={() => opt.onFocus?.(s.key)} onExit={() => opt.onExit(s.key)} />,
            boxOf(s.key), s.key,
          ))}
        </>
      );
    },
  };
}

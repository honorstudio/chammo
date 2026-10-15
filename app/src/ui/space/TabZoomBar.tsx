import { keyLabel } from '../../domain/keys';
import { IS_WIN } from '../../domain/reader';
import { tabZoomLabel, type ZoomCmd } from '../../domain/tabZoom';
import { tr } from '../../i18n';
import { IconZoomFit, IconZoomIn, IconZoomOut } from '../Icons';
import { IconButton } from '../kit/IconButton';

/** 탭 머리 확대 단추(2026-10-12 사용자) — 축소(−) · 배율 글자(누르면 100%) · 확대(+) · 맞춤. 단축키·휠·핀치와 같은 명령(ZoomCmd)으로 들어간다 */
export function TabZoomBar({ z, onCmd }: { z: number; onCmd: (c: ZoomCmd) => void }) {
  return (
    <div className="tz" role="group" aria-label={tr('확대·축소', 'Zoom')}>
      <IconButton size="s" label={tr('축소', 'Zoom out')} title={`${tr('축소', 'Zoom out')} ${keyLabel('⌘-', IS_WIN)}`} onClick={() => onCmd(-1)}><IconZoomOut /></IconButton>
      <button className="tz-pct" onClick={() => onCmd(0)} aria-label={tr('원래 크기로', 'Actual size')} title={`${tr('100%로', 'Reset to 100%')} ${keyLabel('⌘0', IS_WIN)}`}>{tabZoomLabel(z)}</button>
      <IconButton size="s" label={tr('확대', 'Zoom in')} title={`${tr('확대', 'Zoom in')} ${keyLabel('⌘+', IS_WIN)}`} onClick={() => onCmd(1)}><IconZoomIn /></IconButton>
      <IconButton size="s" label={tr('창에 맞춤', 'Fit')} title={`${tr('창에 맞춤', 'Fit')} ${keyLabel('⌘9', IS_WIN)}`} onClick={() => onCmd('fit')}><IconZoomFit /></IconButton>
    </div>
  );
}

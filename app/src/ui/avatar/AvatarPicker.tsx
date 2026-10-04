// 프사 바꾸기 창 — 기본형(도형 13·눈 3·색) 또는 그림·GIF 올리기(동그란 잘림·확대·끌어 옮기기). 시안 v2 D 확정
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assistant, tr } from '../../i18n';
import { avatarKey, baseVoice, defaultVoice, type Voice, checkSize, checkUpload, EYES, EYES_LABEL, ORCH_COLORS, resolveAvatar, SHAPE_LABEL, SHAPES, type Avatar, type Crop, type Eyes, type Preset, type Shape } from '../../domain/avatar';
import { OrchAvatar, cropTransform } from './OrchAvatar';
import { imageUrl, resetAvatar, saveAvatar, useAvatars } from './store';
import { VoiceDial } from './VoiceDial';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));


export function AvatarPicker({ name, label, color, onClose }: { name: string; label: string; color: string; onClose: () => void }) {
  const { saved, dataDir, ttsCommand } = useAvatars();
  const key = avatarKey(name);
  const start = resolveAvatar(saved, name);
  const startPreset: Preset = start.kind === 'preset' ? start : { kind: 'preset', shape: 'circle', eyes: 'pill', color: null };
  const [tab, setTab] = useState<'preset' | 'image'>(start.kind);
  const [preset, setPreset] = useState<Preset>(startPreset);
  // 목소리 — null = 번호 순 기본 배정. 설정이 앱의 Supertonic 이 아니면 base 가 없어 고를 수만 있고 들어 보기는 못 한다
  const [voice, setVoice] = useState<Voice | null>(start.voice ?? null);
  const base = baseVoice(ttsCommand);
  const [crop, setCrop] = useState<Crop>(start.kind === 'image' ? start.crop : { zoom: 1, x: 0, y: 0 });
  const [file, setFile] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const savedUrl = imageUrl(dataDir, saved.get(key));
  const imgSrc = file?.url ?? (start.kind === 'image' ? savedUrl : null);

  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const bad = checkUpload(f);
    if (bad) { setErr(bad); return; }
    const url = URL.createObjectURL(f);
    // 실제로 그림으로 읽히는지·크기는 브라우저에 한 번 열어 본다(형식은 Rust 가 첫 바이트로 다시 본다)
    const dim = await new Promise<[number, number] | null>((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = url; });
    const tooBig = dim ? checkSize(dim[0], dim[1]) : tr('그림을 읽지 못했어요', 'Could not read the image');
    if (tooBig) { URL.revokeObjectURL(url); setErr(tooBig); return; }
    setErr('');
    const bytes = new Uint8Array(await f.arrayBuffer());
    setFile({ bytes, url });
    setCrop({ zoom: 1, x: 0, y: 0 });
  };

  // 끌어서 자리 옮기기 — 확대한 만큼만 움직인다(빈 데가 안 보이게)
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; c: Crop } | null>(null);
  const onDown = (e: React.PointerEvent) => { if (crop.zoom <= 1) return; (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, c: crop }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; const w = box.current?.clientWidth ?? 200;
    if (!d) return;
    const span = (w * (d.c.zoom - 1)) / 2;
    setCrop({ ...d.c, x: clamp(d.c.x + (e.clientX - d.x) / span, -1, 1), y: clamp(d.c.y + (e.clientY - d.y) / span, -1, 1) });
  };
  const onKeyMove = (e: React.KeyboardEvent) => {
    const step = 0.1; const m: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = m[e.key]; if (!v) return;
    e.preventDefault();
    setCrop((c) => ({ ...c, x: clamp(c.x + v[0], -1, 1), y: clamp(c.y + v[1], -1, 1) }));
  };

  const preview: Avatar = tab === 'preset' ? preset : { kind: 'image', file: '', crop };
  const canSave = tab === 'preset' || !!imgSrc;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (tab === 'preset') await saveAvatar(key, { ...preset, voice }, null);
      else await saveAvatar(key, { kind: 'image', file: '', crop, voice }, file?.bytes ?? null);
      onClose();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const reset = async () => { setBusy(true); try { await resetAvatar(key); onClose(); } catch (e) { setErr(String(e)); } finally { setBusy(false); } };

  const av = (p: Avatar, size: number, src?: string | null) => <OrchAvatar name={name} size={size} state="rest" color={color} label={label} preview={p} previewSrc={src ?? undefined} />;
  return createPortal(
    <div className="od-back" onMouseDown={onClose}>
      <div className="od-box oa-picker" role="dialog" aria-modal="true" aria-label={tr(`${label} 프사 바꾸기`, `Change ${label}'s avatar`)} onMouseDown={(e) => e.stopPropagation()}>
        <b>{tr(`${label} 프사`, `${label}'s avatar`)}</b>
        <div className="oa-pk-prev">
          {av(preview, 72, imgSrc)}
          <div className="oa-pk-sizes">{av(preview, 44, imgSrc)}{av(preview, 22, imgSrc)}{av(preview, 16, imgSrc)}</div>
        </div>
        <div className="oa-seg" role="tablist">
          <button role="tab" aria-selected={tab === 'preset'} className={tab === 'preset' ? 'oa-on' : ''} onClick={() => setTab('preset')}>{tr('기본형', 'Character')}</button>
          <button role="tab" aria-selected={tab === 'image'} className={tab === 'image' ? 'oa-on' : ''} onClick={() => setTab('image')}>{tr('그림 올리기', 'Upload image')}</button>
        </div>
        {tab === 'preset' ? (
          <>
            <div className="oa-lbl" id="oa-shape">{tr('도형', 'Shape')}</div>
            <div className="oa-opts" role="radiogroup" aria-labelledby="oa-shape">
              {SHAPES.map((s: Shape) => (
                <button key={s} role="radio" aria-checked={preset.shape === s} aria-label={SHAPE_LABEL[s]()} title={SHAPE_LABEL[s]()} className={`oa-opt ${preset.shape === s ? 'oa-on' : ''}`} onClick={() => setPreset({ ...preset, shape: s })}>
                  {av({ ...preset, shape: s }, 28)}
                </button>
              ))}
            </div>
            <div className="oa-lbl" id="oa-eyes">{tr('눈', 'Eyes')}</div>
            <div className="oa-opts" role="radiogroup" aria-labelledby="oa-eyes">
              {EYES.map((e: Eyes) => (
                <button key={e} role="radio" aria-checked={preset.eyes === e} aria-label={EYES_LABEL[e]()} title={EYES_LABEL[e]()} className={`oa-opt ${preset.eyes === e ? 'oa-on' : ''}`} onClick={() => setPreset({ ...preset, eyes: e })}>
                  {av({ ...preset, shape: 'circle', eyes: e }, 28)}
                </button>
              ))}
            </div>
            <div className="oa-lbl" id="oa-color">{tr('색', 'Color')}</div>
            <div className="oa-opts" role="radiogroup" aria-labelledby="oa-color">
              {ORCH_COLORS.map((c, i) => (
                <button key={c} role="radio" aria-checked={preset.color === c} aria-label={tr(`색 ${i + 1}`, `Color ${i + 1}`)} className={`oa-sw ${preset.color === c ? 'oa-on' : ''}`} style={{ background: c }} onClick={() => setPreset({ ...preset, color: c })} />
              ))}
              <button role="radio" aria-checked={preset.color === null} className={`oa-txt ${preset.color === null ? 'oa-on' : ''}`} onClick={() => setPreset({ ...preset, color: null })}>{tr('순서대로', 'By order')}</button>
            </div>
          </>
        ) : (
          <>
            <label className="oa-drop">
              {tr('눌러서 그림 고르기', 'Click to choose an image')}
              <small>{tr('PNG · JPG · GIF · WebP · 5MB 까지', 'PNG · JPG · GIF · WebP · up to 5 MB')}</small>
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {imgSrc && (
              <>
                <div ref={box} className="oa-crop" tabIndex={0} aria-label={tr('자르기 — 끌거나 화살표로 옮기기', 'Crop — drag or use arrow keys')}
                  onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onKeyDown={onKeyMove}>
                  <img src={imgSrc} alt="" draggable={false} style={{ transform: cropTransform(crop) }} />
                  <div className="oa-mask" />
                </div>
                <label className="oa-zoom">
                  <span>{tr('작게', 'Smaller')}</span>
                  <input type="range" min={100} max={400} value={Math.round(crop.zoom * 100)} aria-label={tr('확대', 'Zoom')}
                    onChange={(e) => { const z = Number(e.target.value) / 100; setCrop((c) => ({ zoom: z, x: z <= 1 ? 0 : c.x, y: z <= 1 ? 0 : c.y })); }} />
                  <span>{tr('크게', 'Larger')}</span>
                </label>
              </>
            )}
          </>
        )}
        <div className="oa-lbl" id="oa-voice">{tr('목소리', 'Voice')}</div>
        <VoiceDial voice={voice} onVoice={setVoice} def={base ? defaultVoice(key, base) : undefined} label={label} color={color} canListen={!!base} />
        {!base && <div className="oa-note">{tr(`설정 > 음성이 Supertonic 일 때 ${assistant()}마다 이 목소리로 읽어요. 지금 설정에선 모두 설정 목소리로 읽어요.`, 'Each assistant uses its own voice when Settings > Voice is Supertonic. With the current setting, everyone uses the settings voice.')}</div>}
        {err && <div className="oa-err" role="alert">{err}</div>}
        <div className="od-foot">
          {saved.has(key) && <button className="oa-reset" onClick={() => void reset()} disabled={busy}>{tr('처음대로', 'Reset')}</button>}
          <button onClick={onClose}>{tr('취소', 'Cancel')}</button>
          <button className="pri" onClick={() => void save()} disabled={busy || !canSave}>{tr('저장', 'Save')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// 영상 검토(큐레이션의 영상판) — 데스크톱·폰이 같이 쓰는 계산. 화면 없이 시험한다. 기획 docs/plans/2026-11-04-video-curation.md
import { tr } from '../i18n';

export type VrFrom = 'desktop' | 'phone' | 'film';
export type VrState = 'open' | 'done' | 'cut' | 'lost' | 'carried';
/** film = 참모 필름 마커 id(scripts/video-review 가 적는다) · state = 판이 바뀔 때 어떻게 됐나 · moved = 옮겨 간 새 판 경로 */
export type VrNote = { id: string; t: number; text: string; at: string; from: VrFrom; film?: { marker: number }; state?: VrState; moved?: string };
const STATES: VrState[] = ['open', 'done', 'cut', 'lost', 'carried'];
/** 기록 파일(curation/<폴더>-<이름>.state.json) — 폰·스페이스·참모 필름이 같이 읽고 쓰는 하나 */
export type VrRecord = { v: 1; source: { path: string; duration?: number; fps?: number }; notes: VrNote[] };
export type VrSprite = { interval: number; cols: number; rows: number; count: number; cw: number; ch: number };

const safe = (t: number) => (Number.isFinite(t) && t > 0 ? t : 0);
const p2 = (n: number) => String(n).padStart(2, '0');

/** 0.1초 표시 — 폰. 자릿수 고정(01:36.0), 한 시간이 넘으면 앞에 시 */
export function fmtTenth(t: number): string {
  const d = Math.round(safe(t) * 10);
  const s = Math.floor(d / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const head = h ? `${h}:${p2(m)}` : p2(m);
  return `${head}:${p2(s % 60)}.${d % 10}`;
}

/** 프레임까지 — PC. 영상의 fps 를 모르면(저용량 준비 전·윈도우) 프레임을 지어내지 않고 0.1초로. 29.97 도 30칸(드롭 프레임 표시 안 함) */
export function fmtFrames(t: number, fps: number | undefined): string {
  if (!fps || !Number.isFinite(fps) || fps <= 0) return fmtTenth(t);
  const v = safe(t);
  const s = Math.floor(v);
  const base = Math.round(fps);
  const ff = Math.min(base - 1, Math.floor(Math.round((v - s) * base * 1000) / 1000));
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}:${p2(ff)}`;
}

/** 눈금 글자·길이 — 0:00, 1:30, 1:02:05 */
export function fmtShort(t: number): string {
  const s = Math.floor(safe(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${p2(m)}:${p2(s % 60)}` : `${m}:${p2(s % 60)}`;
}

const byTime = (a: VrNote, b: VrNote) => a.t - b.t;

export function addNote(notes: VrNote[], t: number, text: string, o: { id: string; at: string; from: VrFrom }): VrNote[] {
  const clean = text.trim();
  if (!clean) return notes;
  return [...notes, { id: o.id, t: Math.round(safe(t) * 1000) / 1000, text: clean, at: o.at, from: o.from }].sort(byTime);
}
export function editNote(notes: VrNote[], id: string, text: string): VrNote[] {
  const clean = text.trim();
  return clean ? notes.map((n) => (n.id === id ? { ...n, text: clean } : n)) : notes;
}
export const removeNote = (notes: VrNote[], id: string): VrNote[] => notes.filter((n) => n.id !== id);

export const emptyRecord = (path: string): VrRecord => ({ v: 1, source: { path }, notes: [] });

/** 파일 → 기록. 깨진 파일·모르는 줄은 버린다. 파일 이름은 <폴더>-<이름> 이라 다른 폴더의 같은 이름과 겹칠 수 있어 경로까지 맞는 것만 받는다 */
export function parseRecord(json: string, path: string): VrRecord {
  let d: unknown;
  try { d = JSON.parse(json); } catch { return emptyRecord(path); }
  const r = d as Partial<VrRecord> | null;
  if (!r || typeof r !== 'object' || r.source?.path !== path || !Array.isArray(r.notes)) return emptyRecord(path);
  const notes = (r.notes as unknown[]).flatMap((x): VrNote[] => {
    const n = x as Partial<VrNote> | null;
    if (!n || typeof n.id !== 'string' || typeof n.t !== 'number' || !Number.isFinite(n.t) || typeof n.text !== 'string' || !n.text.trim()) return [];
    const out: VrNote = { id: n.id, t: n.t, text: n.text, at: typeof n.at === 'string' ? n.at : '', from: n.from === 'phone' || n.from === 'film' ? n.from : 'desktop' };
    if (Number.isInteger(n.film?.marker)) out.film = { marker: n.film!.marker };
    if (n.state && STATES.includes(n.state)) out.state = n.state;
    if (typeof n.moved === 'string' && n.moved) out.moved = n.moved;
    return [out];
  });
  return { v: 1, source: { ...r.source, path }, notes: notes.sort(byTime) };
}

/** 참모에게 보내는 글 — 시각순. 말 안의 줄바꿈은 편다(사람이 친 글이 다른 항목처럼 보이지 않게) */
export function resultText(o: { path: string; duration?: number; notes: VrNote[]; recordPath?: string }): string {
  const name = o.path.split(/[\\/]/).pop() ?? o.path;
  const head = [o.duration ? tr(`길이 ${fmtShort(o.duration)}`, `Length ${fmtShort(o.duration)}`) : '', tr(`말 ${o.notes.length}개`, `${o.notes.length} notes`), o.recordPath ? tr(`기록 ${o.recordPath}`, `Record ${o.recordPath}`) : ''].filter(Boolean).join(' · ');
  const list = o.notes.map((n) => `- ${fmtTenth(n.t)} ${n.text.replace(/\s*\n\s*/g, ' ')}`).join('\n');
  return `## ${tr('영상 검토', 'Video review')} — ${name}\n${head}\n\n${list}`;
}

export function xToTime(x: number, w: number, lo: number, hi: number): number {
  if (!(w > 0)) return lo;
  return lo + (Math.min(w, Math.max(0, x)) / w) * (hi - lo);
}

/** 큰 눈금 간격 후보(초) */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
export type RulerMark = { t: number; x: number; big: boolean };

/** 눈금 — 큰 눈금은 글자(labelW)가 안 겹칠 만큼 벌리고, 사이에 작은 눈금 5칸. 폭·길이가 어떻든 개수가 폭을 안 넘친다 */
export function rulerMarks(lo: number, hi: number, w: number, labelW: number): RulerMark[] {
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0 || !(w > 0)) return [];
  const perSec = w / span;
  const step = STEPS.find((s) => s * perSec >= labelW) ?? STEPS[STEPS.length - 1]!;
  const minor = step / 5;
  const out: RulerMark[] = [];
  const first = Math.ceil(lo / minor);
  for (let i = first; i * minor <= hi + 1e-6; i++) {
    const t = i * minor;
    out.push({ t, x: (t - lo) * perSec, big: i % 5 === 0 });
  }
  return out;
}

/** 눈금 글자(x 부터 w 폭)가 재생 위치 선과 안 겹치나 */
export const labelClear = (x: number, w: number, playX: number) => playX < x || playX > x + w;

/** 길게 눌러 펴기 — 누른 자리 앞뒤 7.5초. 처음·끝에선 밀어서 15초 폭을 지킨다 */
export function zoomWindow(at: number, dur: number, span = 15): { lo: number; hi: number } {
  if (!(dur > span)) return { lo: 0, hi: safe(dur) };
  const lo = Math.max(0, Math.min(dur - span, safe(at) - span / 2));
  return { lo, hi: lo + span };
}

/** 누른 손가락 자리에 그 시각이 그대로 남게 펴기 — 펴는 순간 화면이 안 튄다. x = 눈금 위 손가락 자리 */
export function zoomAround(at: number, x: number, w: number, dur: number, span = 15): { lo: number; hi: number } {
  if (!(dur > span) || !(w > 0)) return { lo: 0, hi: safe(dur) };
  const lo = Math.max(0, Math.min(dur - span, safe(at) - (Math.min(w, Math.max(0, x)) / w) * span));
  return { lo, hi: lo + span };
}

/** 그림 묶음의 칸 — 판 하나에 cols×rows 칸 */
export function spriteCell(t: number, s: VrSprite): { sheet: number; col: number; row: number } {
  const i = Math.max(0, Math.min(s.count - 1, Math.floor(safe(t) / s.interval)));
  const per = s.cols * s.rows;
  const inSheet = i % per;
  return { sheet: Math.floor(i / per), col: inSheet % s.cols, row: Math.floor(inSheet / s.cols) };
}

export type VrPrep = { state: string; pct?: number; low?: number | null; needsLow?: boolean; fps?: number | null; duration?: number | null; sprite?: Partial<VrSprite> | null; record?: string };
export type VrSource = { kind: 'low' | 'orig'; url: string; bytes: number } | { kind: 'wait' };

/** 폰이 무엇을 틀까 — 저용량이 준비되면 그것, 작은 영상·도우미 없음·실패면 원본, 큰 영상을 만드는 중이면 기다림. 옛 데스크톱(prep 없음)도 원본 */
export function phoneSource(t: { url: string; size: number; prep?: VrPrep | null }): VrSource {
  const p = t.prep;
  if (p?.low) return { kind: 'low', url: `${t.url}&low=1`, bytes: p.low };
  if (p?.needsLow && (p.state === 'making' || p.state === 'idle')) return { kind: 'wait' };
  return { kind: 'orig', url: t.url, bytes: t.size };
}

/** 폰 팀 보관함 영상(11-04) — 맥이 받는 동안 보일 줄. total 모르면(목록 받는 중·데스크톱이 먼저 받는 중) 여는 중, 실패 까닭은 넷 */
export type TeamMediaNote = { k: 'open' } | { k: 'fetch'; pct: number; total: number } | { k: 'fail'; why: 'net' | 'disk' | 'gone' | 'other' };
export function teamMediaNote(s: { state: 'going'; done: number; total: number } | { state: 'failed'; why: string }): TeamMediaNote {
  if (s.state === 'failed') return { k: 'fail', why: s.why === 'net' || s.why === 'disk' || s.why === 'gone' ? s.why : 'other' };
  if (!s.total) return { k: 'open' };
  return { k: 'fetch', pct: Math.min(100, Math.floor((s.done / s.total) * 100)), total: s.total };
}

import { invoke } from '@tauri-apps/api/core';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import type { ShowAt } from '../../domain/showAt';
import { tr } from '../../i18n';
import { flashAt } from '../flash';
import './pdf.css';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Doc = pdfjs.PDFDocumentProxy;

/**
 * PDF 를 직접 그린다(pdf.js) — 기본 뷰어(iframe)로는 그 페이지로 보내거나 글을 반짝일 수 없었다(2026-09-30 사용자 "피디에프·피피티면 페이지도 맞춰서").
 * 파워포인트·워드는 LibreOffice 로 바꾼 PDF 를 여기서 그린다. 보이는 페이지만 그리고, 짚은 곳(at)은 그 페이지로 가서 반짝인다
 */
export default function PdfView({ path, zoom = 100, at, atKey }: { path: string; zoom?: number; at?: ShowAt; atKey?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }[]>([]);
  const [err, setErr] = useState('');
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let dead = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    setDoc(null); setErr(''); setSize([]);
    void invoke<ArrayBuffer>('read_doc_bytes', { path })
      .then((buf) => { task = pdfjs.getDocument({ data: new Uint8Array(buf) }); return task.promise; })
      .then(async (x) => {
        if (dead) return;
        // 페이지 크기부터 다 잡아 둔다 — 자리를 미리 비워 둬야 몇 쪽으로 바로 스크롤된다
        const s: { w: number; h: number }[] = [];
        for (let i = 1; i <= x.numPages; i++) { const v = (await x.getPage(i)).getViewport({ scale: 1 }); s.push({ w: v.width, h: v.height }); }
        if (!dead) { setSize(s); setDoc(x); }
      })
      .catch((e) => !dead && setErr(String(e)));
    return () => { dead = true; void task?.destroy(); };
  }, [path]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 한 페이지 폭 = 창 폭(여백 빼고)을 가장 넓은 페이지에 맞춘 뒤 확대
  const widest = size.reduce((m, p) => Math.max(m, p.w), 1);
  const scale = width > 0 ? ((width - 40) / widest) * (zoom / 100) : 0;

  // 보이는 페이지만 그린다
  const drawn = useRef(new Map<number, number>()); // 페이지 → 그린 배율
  const pending = useRef(new Map<number, Promise<void>>());
  const draw = (n: number): Promise<void> => {
    if (!doc || !scale) return Promise.resolve();
    if (drawn.current.get(n) === scale) return pending.current.get(n) ?? Promise.resolve();
    drawn.current.set(n, scale);
    const job = (async () => {
      const host = box.current?.querySelector<HTMLElement>(`.pdfv-page[data-page="${n}"]`);
      if (!host) return;
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
      await page.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
      const text = document.createElement('div');
      text.className = 'textLayer';
      host.style.setProperty('--scale-factor', String(scale));
      host.style.setProperty('--total-scale-factor', String(scale));
      host.style.setProperty('--user-unit', '1');
      await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: vp }).render();
      host.querySelectorAll('canvas, .textLayer').forEach((x) => x.remove());
      host.prepend(canvas, text);
    })();
    pending.current.set(n, job);
    return job;
  };
  useEffect(() => {
    const el = box.current;
    if (!doc || !scale || !el) return;
    drawn.current.clear();
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) void draw(Number((e.target as HTMLElement).dataset.page)); }), { root: el, rootMargin: '600px 0px' });
    el.querySelectorAll('.pdfv-page').forEach((p) => io.observe(p));
    return () => io.disconnect();
  }, [doc, scale]); // eslint-disable-line react-hooks/exhaustive-deps

  // 짚어 보여 주기 — 페이지를 정했으면 거기, 글을 정했으면 그 글이 있는 첫 페이지를 찾아 가서 반짝
  useEffect(() => {
    if (!doc || !scale || !at || (!at.page && !at.find)) return;
    let dead = false;
    void (async () => {
      let n = at.page && at.page <= doc.numPages ? at.page : 0;
      if (!n && at.find) {
        const q = at.find.toLowerCase();
        for (let i = 1; i <= doc.numPages && !n; i++) {
          const t = (await doc.getPage(i).then((p) => p.getTextContent())).items.map((it) => ('str' in it ? it.str : '')).join('').toLowerCase();
          if (t.includes(q) || (q.length > 20 && t.includes(q.slice(0, 20)))) n = i;
        }
      }
      if (dead || !n) return;
      const host = box.current?.querySelector<HTMLElement>(`.pdfv-page[data-page="${n}"]`);
      if (!host) return;
      host.scrollIntoView({ block: at.find ? 'center' : 'start', behavior: 'smooth' });
      await draw(n);
      if (dead) return;
      const layer = host.querySelector<HTMLElement>('.textLayer');
      if (!(at.find && layer && flashAt(layer, { find: at.find }))) ring(host);
    })();
    return () => { dead = true; };
  }, [doc, scale > 0, atKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pdfv" ref={box}>
      {err ? <div className="pdfv-msg">{tr('PDF 를 못 열었어', "Couldn't open the PDF")} — {err}</div>
        : !doc || !scale ? <div className="pdfv-msg">{tr('여는 중', 'Opening')}</div>
        : size.map((p, i) => (
          <div key={i} className="pdfv-page" data-page={i + 1} style={{ width: p.w * scale, height: p.h * scale }}>
            <span className="pdfv-no">{i + 1} / {size.length}</span>
          </div>
        ))}
    </div>
  );
}

/** 페이지만 짚었을 때 — 페이지 둘레가 빛난다 */
function ring(host: HTMLElement) {
  const r = document.createElement('div');
  r.className = 'cv-flash-ring';
  Object.assign(r.style, { inset: '-6px', borderRadius: '6px' });
  host.appendChild(r);
  window.setTimeout(() => r.remove(), 4000);
}

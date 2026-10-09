// 폰 글 파일 보기 — 코드·글(고정폭·줄 번호), json(들여쓰기), csv·tsv(표), md(노션식 읽기 + 속 그림 + 짚은 줄 반짝)
// (전략 표 3·5번, 2026-10-03). 짚은 곳(scripts/show --line/--find)은 그 줄로 스크롤하고 몇 초 반짝인다
import { useEffect, useMemo, useRef } from 'react';
import { docImageUrl } from '../../data/web';
import { csvRows, prettyJson, resolveRel } from '../../domain/phoneFile';
import type { ShowAt } from '../../domain/showAt';
import { flashWhenReady } from '../flash';
import { mdDocToHtml } from '../md';
import { machine } from '../../i18n';

/** 한 번에 그릴 줄 — 넘으면 앞부분만(폰이 멈추지 않게) */
const MAX_LINES = 5000;

/** 줄 번호로 짚었으면 그 줄들에 표시를 달고 가운데로, 글로 짚었으면 글을 찾아 반짝 */
function useLineFlash(root: React.RefObject<HTMLElement | null>, at: ShowAt | undefined, src: string, raw: boolean) {
  useEffect(() => {
    const el = root.current;
    if (!el || !at) return;
    if (at.line && el.querySelector('[data-ln]')) {
      const end = Math.max(at.line, at.lineEnd ?? at.line);
      const hit: Element[] = [];
      for (let n = at.line; n <= end; n++) { const x = el.querySelector(`[data-ln="${n}"]`); if (x) hit.push(x); }
      hit[0]?.scrollIntoView({ block: 'center' });
      hit.forEach((x) => x.classList.add('m-ln-hit'));
      const t = window.setTimeout(() => hit.forEach((x) => x.classList.remove('m-ln-hit')), 6000);
      return () => window.clearTimeout(t);
    }
    return flashWhenReady(() => root.current, at, src, raw);
  }, [root, at, src, raw]);
}

export function CodeText({ text, json, at }: { text: string; json?: boolean; at?: ShowAt }) {
  // json 은 들여쓰기 — 줄 번호로 짚었으면 원래 줄이 맞게 그대로
  const shown = useMemo(() => (json && !at?.line ? prettyJson(text) ?? text : text), [text, json, at?.line]);
  const lines = useMemo(() => shown.split('\n'), [shown]);
  const box = useRef<HTMLDivElement>(null);
  useLineFlash(box, at, shown, true);
  return (
    <div className="m-code" ref={box}>
      {lines.slice(0, MAX_LINES).map((l, i) => (
        <div key={i} className="m-ln" data-ln={i + 1}><span className="m-ln-no" aria-hidden>{i + 1}</span><span className="m-ln-t">{l || ' '}</span></div>
      ))}
      {lines.length > MAX_LINES && <p className="m-muted m-sm">앞 {MAX_LINES}줄만 — 나머지는 {machine()}에서</p>}
    </div>
  );
}

export function CsvTable({ text, tab }: { text: string; tab: boolean }) {
  const rows = useMemo(() => csvRows(text, tab ? '\t' : ','), [text, tab]);
  const [head, ...body] = rows;
  return (
    <div className="m-csv">
      <table>
        {head && <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>}
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
      {rows.length >= 1000 && <p className="m-muted m-sm">앞 1000줄만 — 나머지는 {machine()}에서</p>}
    </div>
  );
}

/** md — 문서 보기(.m-page = 데스크톱 문서 페이지 톤, 채팅 말풍선 .m-md 와 따로). 속 그림(상대 경로)은 그 문서 덕에 서버가 열어 준다(doc). 다 쓰면 blob 주소를 놓는다 */
export function MdDoc({ path, text, at }: { path: string; text: string; at?: ShowAt }) {
  const html = useMemo(() => mdDocToHtml(text), [text]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const urls: string[] = [];
    let alive = true;
    el.querySelectorAll('img').forEach((img) => {
      const abs = resolveRel(path, img.getAttribute('src') ?? '');
      if (!abs) return;
      img.removeAttribute('src');
      img.classList.add('m-md-wait');
      docImageUrl(abs, path).then((u) => {
        if (!alive) { URL.revokeObjectURL(u); return; }
        urls.push(u);
        img.src = u;
        img.classList.remove('m-md-wait');
      }, () => img.classList.replace('m-md-wait', 'm-md-miss'));
    });
    return () => { alive = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [html, path]);
  useLineFlash(box, at, text, false);
  return <div ref={box} className="m-doc m-md m-page" dangerouslySetInnerHTML={{ __html: html }} />;
}

// 접는 목록·접는 제목 → md(2026-11-09 사용자) — md 엔 접기가 없어 편집기(BlockNote)는 그냥 목록(+ 글자 `*`)·그냥 제목으로 써서 다시 열면 접힘이 사라졌다.
// <details><summary> 로 쓴다: 편집기가 이 모양을 접는 블록(안쪽 블록까지)으로 읽고, GitHub·VS Code 미리보기는 접히고, 그 밖 도구도 글은 그대로 보인다.
// summary 는 HTML 블록 안이라 md 꾸밈(**)이 안 먹는다 — 글은 편집기가 쓴 HTML(굵게·링크·코드)로 받는다

/** 접는 블록 하나 — summary = 블록 글 HTML, level = 접는 제목 수준(접는 목록이면 null), kids = 안쪽 블록 md */
export function toggleMd(summary: string, level: number | null, kids: string): string {
  const head = `<details>\n<summary>${level ? `<h${level}>${summary}</h${level}>` : summary}</summary>`;
  return kids.trim() ? `${head}\n\n${kids.trim()}\n\n</details>` : `${head}\n</details>`;
}

/** 편집기가 쓴 블록 글 HTML → summary 글 — <p> 껍질을 벗기고, 링크는 href 만(편집기 내부 속성 target·rel·classname·data-* 이 md 에 안 남게) */
export function summaryHtml(html: string): string {
  return html.trim().replace(/^<p[^>]*>|<\/p>$/g, '').replace(/<a\s[^>]*?(href="[^"]*")[^>]*>/g, '<a $1>');
}

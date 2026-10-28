// 채팅 말풍선 마크다운 → 안전한 HTML — 데스크톱 채팅(ChatView)과 폰(ui/mobile)이 같은 길을 쓴다.
// marked 로 바꾸고 DOMPurify 로 거른다(스크립트·on* 속성·javascript: 주소는 DOMPurify 가 지운다). style·iframe·object·embed·form·img 는 아예 금지
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { mdSafe } from '../domain/chat';
import { docImgSrcOk } from '../domain/phoneFile';
import { linkParts, webHref } from '../domain/links';

const FORBID_TAGS = ['style', 'iframe', 'object', 'embed', 'form', 'img'];
/** 답 글이 앱 화면을 흉내 내지 못하게 — class·style·id 가 살아 있으면 '앱이 전함' 줄·승인 카드 모양을 그대로 그리거나 화면 전체를 덮었다(2026-10-21 리뷰) */
export const SANITIZE = { FORBID_TAGS, FORBID_ATTR: ['style', 'class', 'id'], ALLOW_DATA_ATTR: false };
// **굵게** 를 한글 바로 앞에서 닫으면(**"첫 참모"**를) CommonMark 규칙상 못 닫혀 별표가 남는다 — 앞뒤 글자를 안 따지는 굵게를 먼저 본다.
// 전역 marked 를 바꾸지 않게 이 파일만의 인스턴스(Reader 는 기본 그대로)
const md = new Marked({ async: false, breaks: true }, {
  extensions: [{
    name: 'strongCjk',
    level: 'inline',
    start: (src: string) => src.indexOf('**'),
    tokenizer(src: string) {
      const m = /^\*\*(?=\S)([^*\n]*?\S)\*\*/.exec(src);
      if (m) return { type: 'strong', raw: m[0], text: m[1]!, tokens: this.lexer.inlineTokens(m[1]!) };
    },
  }],
});
export const mdParse = (text: string) => md.parse(mdSafe(text)) as string;

/** 데스크톱 — 링크는 화면 쪽 클릭 처리(followLink)가 연다 */
export const mdToHtml = (text: string) => DOMPurify.sanitize(mdParse(text), SANITIZE);

/** 팀챗 참모 말 — 참모 채팅과 같은 마크다운·거름. 남의 글이라 링크는 웹 주소만 살리고(나머지는 글로) 실제 주소를 title 로 —
 *  보이는 글이 주소와 달라도 올리면 어디로 가는지 보인다. 폰은 새 탭. 부르기(@이름)는 맨 글처럼 칩(코드·링크 안은 그대로) */
export function mdToHtmlTeam(text: string, opt: { newTab: boolean; mention: (s: string) => { t: string; s: string; me?: boolean }[] }): string {
  const frag = DOMPurify.sanitize(mdParse(text), { ...SANITIZE, RETURN_DOM_FRAGMENT: true });
  for (const a of [...frag.querySelectorAll('a')]) {
    // 맨 주소 자동 링크는 marked 가 바로 뒤 한글(조사)까지 주소로 잡는다 — 맨 글과 같은 자르기(linkParts)로 다시
    const raw = a.textContent ?? '';
    const cut = webHref(raw) ? linkParts(raw)[0] : undefined;
    if (cut?.t === 'url' && cut.s !== raw) { a.textContent = cut.s; a.setAttribute('href', cut.s); a.after(raw.slice(cut.s.length)); }
    const href = webHref(a.getAttribute('href'));
    if (!href) { a.replaceWith(...a.childNodes); continue; }
    a.setAttribute('title', href);
    if (opt.newTab) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
  }
  const walk = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!n.parentElement?.closest('code, pre, a')) texts.push(n as Text);
  for (const n of texts) {
    const parts = opt.mention(n.data);
    if (!parts.some((p) => p.t === 'mention')) continue;
    n.replaceWith(...parts.map((p) => {
      if (p.t !== 'mention') return p.s;
      const el = document.createElement('span');
      el.className = p.me ? 'tmx-mn me' : 'tmx-mn';
      el.textContent = p.s;
      return el;
    }));
  }
  const box = document.createElement('div');
  box.append(frag);
  return box.innerHTML;
}

// 폰 — 링크는 새 탭 + rel=noopener noreferrer. 걸이(hook)는 폰 전용 인스턴스에만 건다(데스크톱 DOMPurify 는 그대로)
let phone: ReturnType<typeof DOMPurify> | null = null;
export function mdToHtmlNewTab(text: string): string {
  if (!phone) {
    phone = DOMPurify(window);
    phone.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  return phone.sanitize(mdParse(text), { ...SANITIZE, ADD_ATTR: ['target'] });
}

// 폰 문서 보기(md 파일) — 속 그림을 살린다. 단 상대 경로만(서버가 그 문서 덕에 열어 준다, 폰 보기 MdDoc) — 웹 그림·data: 는 지운다(폰 주소가 남에게 새지 않게)
let phoneDoc: ReturnType<typeof DOMPurify> | null = null;
export function mdDocToHtml(text: string): string {
  return docPurifier().sanitize(mdParse(text), { FORBID_TAGS: FORBID_TAGS.filter((t) => t !== 'img'), ADD_ATTR: ['target'] });
}
/** 폰 워드 보기(맥 textutil 이 바꾼 html) — 같은 거름, 그림은 상대 경로만(워드 속 그림은 대개 빠진다) */
export const wordDocToHtml = (html: string) => docPurifier().sanitize(html, { FORBID_TAGS: FORBID_TAGS.filter((t) => t !== 'img'), ADD_ATTR: ['target'] });
function docPurifier(): ReturnType<typeof DOMPurify> {
  if (!phoneDoc) {
    phoneDoc = DOMPurify(window);
    phoneDoc.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src') ?? '';
        if (!docImgSrcOk(src)) node.removeAttribute('src');
        node.removeAttribute('srcset');
      }
    });
  }
  return phoneDoc;
}

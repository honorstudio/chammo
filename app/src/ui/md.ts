// 채팅 말풍선 마크다운 → 안전한 HTML — 데스크톱 채팅(ChatView)과 폰(ui/mobile)이 같은 길을 쓴다.
// marked 로 바꾸고 DOMPurify 로 거른다(스크립트·on* 속성·javascript: 주소는 DOMPurify 가 지운다). style·iframe·object·embed·form·img 는 아예 금지
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { mdSafe } from '../domain/chat';
import { docImgSrcOk } from '../domain/phoneFile';

const FORBID_TAGS = ['style', 'iframe', 'object', 'embed', 'form', 'img'];
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
export const mdToHtml = (text: string) => DOMPurify.sanitize(mdParse(text), { FORBID_TAGS });

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
  return phone.sanitize(mdParse(text), { FORBID_TAGS, ADD_ATTR: ['target'] });
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

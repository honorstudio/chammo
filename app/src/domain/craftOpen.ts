// 파일을 어느 참모 앱(Craft)으로 여나(2026-10-26 사용자 "참모 벡터가 있으면 .ai 는 벡터로 열려야") — 팀 보관함·대화 파일·채팅 칩·참모 보관함·미리보기 머리가 같이 쓴다.
// 기준: 스페이스가 제대로 보여 주는 것(그림·PDF·영상·소리·엑셀 표·워드·슬라이드·글)은 미리보기가 기본이고 '참모 ○○로 열기'를 곁에,
// 스페이스가 그림 한 장(QuickLook)밖에 못 보여 주는 것(.ai·.psd·.dwg …)은 참모 앱이 기본이고 '미리보기'를 곁에.
// 표는 앱이 선언한 문서 형식(Info.plist — 벡터·표·PDF)과 scripts/craft OPEN 표에서. 같은 표가 hq-craft 스킬 '어떤 파일은 어느 앱'에 있다
import { tr, josa } from '../i18n';
import { isSheet, kindOf, pageDoc } from './reader';
import { isWebUrl } from './webUrl';
import { sizeText } from './craftDrawer';

/** 앱 → 그 앱이 기본으로 여는 확장자. 한 확장자는 한 앱에만(먼저 적힌 앱) — .dxf 는 캐드, .pdf 는 PDF, .svg 는 벡터 */
const EXT: [string, string[]][] = [
  ['cadcraft', ['dwg', 'dxf']],
  ['vectorcraft', ['ai', 'ait', 'eps', 'svg', 'svgz', 'af', 'afdesign', 'afpub', 'emf', 'wmf', 'vectorcraft', 'vctemplate']],
  ['photocraft', ['psd', 'psb', 'kra', 'ora', 'xcf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic']],
  ['gridcraft', ['xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv']],
  ['wordcraft', ['docx']],
  ['deckcraft', ['pptx']],
  ['pdfcraft', ['pdf']],
  ['figcraft', ['fig', 'figcraft']],
  ['designcraft', ['designcraft']],
  ['filmcraft', ['fcproj', 'mp4', 'mov', 'm4v', 'webm']],
  ['effectcraft', ['ecproj']],
  ['soundcraft', ['scproj', 'scraft', 'wav', 'mp3', 'm4a', 'aac', 'flac', 'aif', 'aiff']],
];
const BY_EXT = new Map<string, string>();
for (const [app, exts] of EXT) for (const e of exts) if (!BY_EXT.has(e)) BY_EXT.set(e, app);

/** 서랍 이름(scripts/craft CHAMMO 표와 같은 이름) — 서랍을 아직 안 읽었을 때 글 */
const NAME: Record<string, [string, string]> = {
  photocraft: ['참모 포토', 'Chammo Photo'], vectorcraft: ['참모 벡터', 'Chammo Vector'], wordcraft: ['참모 문서', 'Chammo Word'],
  pdfcraft: ['참모 PDF', 'Chammo PDF'], gridcraft: ['참모 표', 'Chammo Grid'], deckcraft: ['참모 슬라이드', 'Chammo Deck'],
  designcraft: ['참모 디자인', 'Chammo Design'], figcraft: ['참모 화면', 'Chammo Fig'], filmcraft: ['참모 필름', 'Chammo Film'],
  effectcraft: ['참모 이펙트', 'Chammo Effect'], soundcraft: ['참모 사운드', 'Chammo Sound'], cadcraft: ['참모 캐드', 'Chammo CAD'],
  lightcraft: ['참모 라이트', 'Chammo Light'],
};

const extOf = (path: string) => path.toLowerCase().split(/[\\/]/).pop()?.match(/\.([a-z0-9]+)$/)?.[1] ?? '';

/** 이 파일을 여는 참모 앱 — 없으면 null */
export function craftFor(path: string): string | null {
  if (isWebUrl(path)) return null;
  return BY_EXT.get(extOf(path)) ?? null;
}

/** 누르면 참모 앱으로 바로 여나 — 참모 앱이 있고 스페이스가 그림 한 장밖에 못 보여 주는 형식 */
export const craftFirst = (path: string) => !!craftFor(path) && kindOf(path) === 'other' && !pageDoc(path) && !isSheet(path);

/** 참모 앱이 기본인 확장자 전부 — scripts/show 의 CRAFT_FIRST 표와 같아야 한다(시험이 견준다) */
export const craftFirstExts = () => [...BY_EXT.keys()].filter((e) => craftFirst(`x.${e}`)).sort();

/** 앱 이름 — 서랍이 준 이름이 먼저 */
export const craftName = (app: string, given?: string | null) => given || (NAME[app] ? tr(NAME[app][0], NAME[app][1]) : app);

/** '참모 벡터로 열기' */
export const openWithLabel = (name: string) => {
  const c = name.charCodeAt(name.length - 1) - 0xac00;
  const ro = c >= 0 && c <= 11171 && c % 28 && c % 28 !== 8 ? '으로' : '로'; // ㄹ 받침은 '로'
  return tr(`${name}${ro} 열기`, `Open in ${name}`);
};

/** 안 깔린 앱 — 사람 확인 한 번 */
export const installAsk = (name: string, bytes: number | null | undefined) => {
  const s = sizeText(bytes);
  return tr(`${josa(name, '을', '를')} 설치하고 열까요?${s ? ` (${s})` : ''}`, `Install ${name} and open it?${s ? ` (${s})` : ''}`);
};

/** 우클릭 '다르게 열기' 한 줄 — 참모 앱이 기본이면 미리보기, 미리보기가 기본이면 '참모 ○○로 열기'. 참모 앱이 없는 형식은 null */
export function altOpen(path: string, given?: string | null): { how: 'craft' | 'preview'; label: string } | null {
  const app = craftFor(path);
  if (!app) return null;
  return craftFirst(path) ? { how: 'preview', label: tr('미리보기', 'Preview') } : { how: 'craft', label: openWithLabel(craftName(app, given)) };
}

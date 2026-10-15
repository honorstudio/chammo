// 폰 파일 받기 — 보여 준 파일을 iOS 공유 시트(파일 앱 저장·사진 저장·카톡 보내기)로, 안 되면 내려받기 링크로(2026-10-11 사용자).
// 공유는 파일을 통째로 메모리에 올려야 해서 큰 파일은 내려받기(사파리 → 파일 앱). 화면·통신 없음

/** 공유 시트로 넘길 최대 크기 */
export const SHARE_MAX = 50 * 1024 * 1024;

/** canShareFiles = navigator.canShare({ files }) 가 이 파일을 받나 */
export const sharePlan = (size: number, canShareFiles: boolean): 'share' | 'download' => (canShareFiles && size <= SHARE_MAX ? 'share' : 'download');

/** File 형식 — 맥이 준 MIME 에서 charset 같은 꼬리를 뗀다 */
export const fileType = (mime: string) => mime.split(';')[0]!.trim() || 'application/octet-stream';

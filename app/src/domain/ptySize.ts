/** 터미널 칸 수 — pty 에 알린 것과 지금 화면이 다르면 다시 알릴 크기, 같으면 null */
export type Size = { cols: number; rows: number };
export const resizeAfterOpen = (sent: Size, now: Size): Size | null => (sent.cols === now.cols && sent.rows === now.rows ? null : { cols: now.cols, rows: now.rows });

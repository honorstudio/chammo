// 폰 사진 줄여 올리기 — 긴 변 2048·JPEG 0.85(domain/mobile shrinkPlan). HEIC 는 사파리가 그릴 수 있어 여기서 JPEG 로.
// 못 그리면(낯선 형식) 원본 그대로 올린다 — 맥 서버가 형식을 다시 본다
import { shrinkPlan } from '../../domain/mobile';

async function draw(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const b = await createImageBitmap(file);
    return { src: b, w: b.width, h: b.height, done: () => b.close() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) return file;
  try {
    const d = await draw(file);
    try {
      const plan = shrinkPlan(d.w, d.h, file.size, file.type || 'image/heic');
      if (!plan) return file;
      const c = document.createElement('canvas');
      c.width = plan.w;
      c.height = plan.h;
      c.getContext('2d')?.drawImage(d.src, 0, 0, plan.w, plan.h);
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
      return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } finally {
      d.done();
    }
  } catch {
    return file;
  }
}

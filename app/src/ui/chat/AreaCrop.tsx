// 입력칸 #area 칩 — 상자 부분만 잘라 보이는 작은 그림(2026-11-13 물어보기). 칩 줄에 box=0.02,0.105,… 숫자를 늘어놓는 대신
// 무엇을 골랐는지 눈으로(숫자는 칩 title 에). 그림 크기는 불러온 뒤에야 알아서 그 전엔 빈 칸
import { useState } from 'react';
import { areaOf, cropOf, type Box } from '../../domain/askPick';
import { docUrl } from '../../domain/reader';

/** at = 입력칸 칩 자리 글("경로" box=…), 또는 path·box 를 바로(보낸 말풍선 — splitPaths 가 이미 읽었다) */
export function AreaCrop({ at, path, box, height = 24 }: { at?: string; path?: string; box?: Box; height?: number }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const a = path && box ? { path, box } : areaOf(at);
  if (!a) return null;
  const c = nat ? cropOf(a.box, nat, height) : null;
  return (
    <span className="chat-ref-crop" style={{ width: c?.w ?? height, height }} aria-hidden>
      <img src={docUrl(a.path)} alt="" draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={c ? { width: c.img.width, height: c.img.height, left: c.img.left, top: c.img.top } : { opacity: 0 }} />
    </span>
  );
}

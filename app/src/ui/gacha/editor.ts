// gacha.json 고치기를 한 줄로 세운다 — 읽고·바꾸고·쓰기가 서로 끼어들지 않게.
// 코인 적립(먹이가 바뀔 때마다 읽고 다시 씀)이 가구 놓기·뽑기·장착 사이에 끼면 옛 파일로 덮어 방금 놓은 자리를 잃었다(2026-10-10)
import { parseGacha, type GachaFile } from '../../domain/gacha';

/** op 이 null 이거나 같은 걸 돌려주면 안 쓴다. since = 파일이 없을 때 코인을 세기 시작할 때 */
export function makeEditor(read: () => Promise<string>, write: (json: string) => Promise<void>, since: number | (() => number)) {
  let chain: Promise<unknown> = Promise.resolve();
  return <T extends GachaFile | null>(op: (f: GachaFile, raw: string) => T): Promise<T> => {
    const run = chain.then(async () => {
      const raw = await read();
      const f = parseGacha(raw, typeof since === 'function' ? since() : since);
      const next = op(f, raw);
      if (next && (next !== f || !raw)) await write(JSON.stringify(next));
      return next;
    });
    chain = run.catch(() => {});
    return run;
  };
}

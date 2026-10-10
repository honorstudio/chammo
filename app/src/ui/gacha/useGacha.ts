// 머지 가챠 상태: gacha.json 을 읽고, 다마고치 먹이 사건(feed)이 오면 코인을 쌓아 다시 쓴다. 뽑기도 여기서.
// 고치기는 전부 한 줄(editor) — 코인 적립이 가구 놓기·뽑기 사이에 끼어 옛 파일로 덮지 않게
import { useCallback, useEffect, useState } from 'react';
import { readGacha, writeGacha, type AppEnv } from '../../data/tauri';
import { dayStartAt, earn, place, pull, seeItem, setSkin as setSkinOf, toggleEquip, type GachaFile, type PullResult } from '../../domain/gacha';
import type { TamaEvent } from '../../domain/tama/pet';
import { makeEditor } from './editor';

// 처음 켠 날은 그날 새벽 5시부터 한 일이 첫 코인
const edit = makeEditor(readGacha, writeGacha, () => dayStartAt(Date.now()));

export function useGacha(env: AppEnv | null, feed: TamaEvent[]) {
  const [file, setFile] = useState<GachaFile | null>(null);
  /** 방금 들어온 코인 — 사무실 코인 칸이 잠깐 반짝인다 */
  const [gain, setGain] = useState<{ n: number; at: number } | null>(null);

  useEffect(() => {
    if (!env) return;
    let alive = true;
    const now = Date.now();
    let gained = 0;
    void edit((f) => { const r = earn(f, feed, now); gained = r.gained; return r.file; }).then((f) => {
      if (!alive) return;
      setFile(f);
      if (gained > 0) setGain({ n: gained, at: now });
    }).catch(() => {});
    return () => { alive = false; };
  }, [env, feed]);

  /** 바꾸고 화면에도 — 바뀐 게 없으면 화면 그대로 */
  const change = useCallback(async (op: (f: GachaFile) => GachaFile | null) => {
    const next = await edit(op);
    if (next) setFile(next);
    return next;
  }, []);

  /** 뽑기 — 코인이 모자라면 null */
  const draw = useCallback(async (n: 1 | 10): Promise<PullResult[] | null> => {
    let results: PullResult[] | null = null;
    await change((f) => { const r = pull(f, n, Math.random); results = r?.results ?? null; return r?.file ?? null; });
    return results;
  }, [change]);

  /** 도감에서 누르기 — NEW 끄고, 스킨·모자·창밖·이펙트·반장 액션이면 장착/해제(가구·펫 친구는 NEW 만) */
  const equip = useCallback(async (id: string) => { await change((f) => toggleEquip(seeItem(f, id), id)); }, [change]);

  /** 가구 놓기 — 칸에(null = 창고) */
  const placeItem = useCallback(async (id: string, cell: [number, number] | null) => { await change((f) => place(f, id, cell)); }, [change]);

  /** 스킨 화면에서 고르기 — 도감 장착과 같은 칸(equip.skin), 'wood' = 기본 */
  const setSkin = useCallback(async (name: string) => { await change((f) => setSkinOf(seeItem(f, `skin.${name}`), name)); }, [change]);

  return { file, gain, draw, equip, placeItem, setSkin };
}

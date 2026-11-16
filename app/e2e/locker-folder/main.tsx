// 보관함에 폴더를 끌어 놓은 뒤 화면 — ?v=before(옛 막힘 띠) · after(연결 폴더로 들어감) · open(그 폴더 안) · fail(남는 실패 짧은 한 줄)
// 띠 글은 Rust 가 내는 글 그대로(옛 check · 새 fail_line — locker_fs_tests 가 같은 글을 잰다)
import { createRoot } from 'react-dom/client';
import '../../src/ui/layers.css';
import type { LkEntry, LkPlace } from '../../src/domain/lockerTree';

const w = window as unknown as { __TAURI_INTERNALS__: unknown };
w.__TAURI_INTERNALS__ = { invoke: async () => null, transformCallback: () => 0, convertFileSrc: (p: string) => p };

const DIR = '/H/Documents/Chammo/디자인 담당';
const SRC = '/H/Desktop/captureone/26-11-12 촬영/Selects';
const v = new URLSearchParams(location.search).get('v') ?? 'before';
const f = (rel: string, o: Partial<LkEntry> = {}): LkEntry => ({ rel, name: rel.split('/').pop()!, dir: false, gone: false, vers: 0, ...o });
const base: LkEntry[] = [
  ...['견본', 'Craft', '간판', '명함', '발주', '자료'].map((r) => f(r, { dir: true })),
  f('견본/소개서.pdf'), f('Craft/로고.svg'), f('간판/시안.png'), f('명함/앞.pdf'),
];
const linked: LkEntry[] = [
  f('Selects', { dir: true, linked: true, link: SRC }),
  ...['6730.jpg', '6749.jpg', '6787.jpg', '6855.jpg'].map((n) => f(`Selects/245A${n}`, { ro: true, size: 4_200_000 })),
];
const entries = v === 'before' || v === 'fail' ? base : [...base, ...linked];
const msg = v === 'before' ? `폴더는 못 넣어 — 파일만: ${SRC}` : v === 'fail' ? '‘Selects’ 를 못 넣었어 — 권한 없음' : null;
const place: LkPlace = v === 'open' ? { kind: 'dir', rel: 'Selects' } : { kind: 'root' };
const noop = () => {};

async function main() {
  await import('../../src/ui/styles.css');
  await import('../../src/ui/space/space.css');
  const { LockerPage } = await import('../../src/ui/space/LockerPage');
  const { IconClose } = await import('../../src/ui/Icons');
  return (
    <div className="app" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
      {msg && <div className="banner warn"><span>{msg}</span><button className="ib" aria-label="닫기" title="닫기"><IconClose /></button></div>}
      <div className="space cv" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="lk-main"><div className="lk-center">
          <LockerPage dir={DIR} place={place as Exclude<LkPlace, { kind: 'home' }>} entries={entries} log={[]} chips={{ active: [], all: [] }} projects={[]} whoOf={() => '나'}
            onPlace={noop} onChoose={noop} onConnect={noop} onNewFolder={noop} acts={{ onOpen: noop, onSend: noop }} kit={{} as never} />
        </div></div>
      </div>
    </div>
  );
}
void main().then((el) => createRoot(document.getElementById('root')!).render(el));

// 오픈소스 라이선스 — Chammo 메뉴 'Chammo 정보' 아래(2026-10-19 사용자 v8 B1, 앱 서랍 아래 줄 대신).
// Craft 앱은 서랍과 같은 자료(scripts/craft 앱 표·참모 앱 표·Info.plist ChammoBasedOn)에서 자동 — 앱이 늘어도 손 안 댄다.
// 아래 칸은 Chammo 가 담아 가는 것의 고지(public/licenses/THIRD_PARTY_NOTICES.md, scripts/third-party-notices 가 만든다) — 라이선스 문안별 절, 본문은 펼 때만 그린다.
// 사용 조건(public/licenses/TERMS.md)은 파일이 있을 때만 — 없는 파일을 물으면 앱이 index.html 을 돌려줘서 termsBody 가 머리로 가른다
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import { licenseLine, licenseRows, noticeText, parseNotices, termsBody, type DrawerRow } from '../domain/craftDrawer';
import { IconClose } from './Icons';
import './licenses.css';

const LICENSE = 'MIT OR Apache-2.0';

function Notice({ name, license, text }: { name: string; license?: string; text: () => string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="lic-notice" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><b>{name}</b>{license && <span className="lic-l">{license}</span>}</summary>
      {open && <pre>{text()}</pre>}
    </details>
  );
}

export function LicensesDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<DrawerRow[] | null>(null);
  const [notices, setNotices] = useState<{ name: string; license: string; body: string }[]>([]);
  const [apache, setApache] = useState('');
  const [terms, setTerms] = useState<string | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    void invoke<DrawerRow[]>('craft_apps', { refresh: false, fast: true }).then(setRows, () => setRows([]));
    void fetch('/licenses/THIRD_PARTY_NOTICES.md').then((r) => (r.ok ? r.text() : '')).then((t) => setNotices(parseNotices(t)), () => {});
    void fetch('/licenses/Apache-2.0.txt').then((r) => (r.ok ? r.text() : '')).then(setApache, () => {});
    void fetch('/licenses/TERMS.md').then((r) => (r.ok ? r.text() : '')).then((t) => setTerms(termsBody(t)), () => {});
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const closeLabel = tr('닫기', 'Close');
  return (
    <div className="tour" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tour-card lic-card" role="dialog" aria-modal="true" aria-label={tr('오픈소스 라이선스', 'Open-source licenses')}>
        <div className="lic-head">
          <h2>{tr('오픈소스 라이선스', 'Open-source licenses')}</h2>
          <button className="ib" aria-label={closeLabel} title={closeLabel} onClick={onClose}><IconClose /></button>
        </div>
        <div className="lic-scroll">
          <p className="lic-sub">{tr('Chammo 는 Honor Studio 의 소프트웨어예요. 공개 저장소의 소스는 AGPL-3.0 을 따라요', 'Chammo is software by Honor Studio. The source in the public repository is under AGPL-3.0')}</p>
          {terms && (
            <Notice name={tr('사용 조건', 'Terms of use')} text={() => terms} />
          )}
          <p className="lic-sub">{tr("Craft 앱은 오픈소스 ArtCraft(github.com/storytold)를 바탕으로 해요. 원작 이름과 로고는 ArtCraft Team의 상표예요. '참모 ○○'는 우리가 빌드한 버전이에요", "The Craft apps are built on the open-source ArtCraft (github.com/storytold). Original names and logos are ArtCraft Team trademarks. 'Chammo …' apps are our builds")}</p>
          <div className="lic-list">
            {(rows ? licenseRows(rows) : []).map((r) => (
              <div key={r.app} className="lic-row">
                {r.icon ? <img src={r.icon} alt="" /> : <span className="lic-ph" />}
                <span className="lic-main">
                  <b>{r.chammo ? r.name : r.origName}</b>
                  <span>{licenseLine(r)}</span>
                </span>
                <span className="lic-l">{LICENSE}</span>
              </div>
            ))}
          </div>
          <p className="lic-foot">{tr('Craft 앱은 받을 때 체크섬·번들 이름·애플 공증을 확인한 뒤에만 깔아요', 'Craft apps are installed only after the checksum, bundle id and Apple notarization check out')}</p>
          {notices.length > 0 && (
            <>
              <div className="lic-sec">{tr('Chammo 가 담아 가는 것', 'Bundled with Chammo')}</div>
              {notices.map((n) => (
                <Notice key={n.name} name={n.name} license={n.license} text={() => noticeText(n.body, apache)} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

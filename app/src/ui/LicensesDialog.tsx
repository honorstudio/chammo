// 오픈소스 라이선스 — Chammo 메뉴 'Chammo 정보' 아래(2026-10-19 사용자 v8 B1, 앱 서랍 아래 줄 대신).
// Craft 앱은 서랍과 같은 자료(scripts/craft 앱 표·참모 앱 표·Info.plist ChammoBasedOn)에서 자동 — 앱이 늘어도 손 안 댄다.
// 아래 칸은 Chammo 가 담아 가는 것의 고지 원문(public/licenses/THIRD_PARTY_NOTICES.md) — 있는 절만
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import { licenseLine, licenseRows, parseNotices, type DrawerRow } from '../domain/craftDrawer';
import { IconClose } from './Icons';
import './licenses.css';

const LICENSE = 'MIT OR Apache-2.0';

export function LicensesDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<DrawerRow[] | null>(null);
  const [notices, setNotices] = useState<{ name: string; license: string; body: string }[]>([]);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    void invoke<DrawerRow[]>('craft_apps', { refresh: false, fast: true }).then(setRows, () => setRows([]));
    void fetch('/licenses/THIRD_PARTY_NOTICES.md').then((r) => (r.ok ? r.text() : '')).then((t) => setNotices(parseNotices(t)), () => {});
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
        <p className="lic-sub">{tr("Craft 앱은 ArtCraft(github.com/storytold) 오픈소스 — 원작 이름·로고는 ArtCraft Team 상표. '참모 ○○' 는 우리가 빌드한 판", "The Craft apps are ArtCraft (github.com/storytold) open source — original names and logos are ArtCraft Team trademarks. 'Chammo …' apps are our builds")}</p>
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
              <details key={n.name} className="lic-notice">
                <summary><b>{n.name}</b><span className="lic-l">{n.license}</span></summary>
                <pre>{n.body}</pre>
              </details>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

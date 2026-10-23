//! 포트를 쓰는 시험끼리 줄 세우기 — 모바일 시험은 빈 포트를 잠깐 열어 번호만 받고 닫은 뒤 다시 연다. 그 사이 127.0.0.1:0 에 붙는
//! 다른 시험(팀 로그인 루프백·팀 방 가짜 서버)이 그 번호를 집으면 AddrInUse 로 깨졌다(10-23 team-accounts, 전체 시험 두 번에 두 번)
use std::sync::{Mutex, MutexGuard};

static PORTS: Mutex<()> = Mutex::new(());

pub fn lock() -> MutexGuard<'static, ()> {
    PORTS.lock().unwrap_or_else(|e| e.into_inner())
}

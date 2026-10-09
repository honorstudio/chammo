//! 말하는 빛의 박자 — 소리가 실제로 귀에 닿는 시각을 잰다(2026-10-10 사용자 QA "가끔 소리와 박자가 안 맞는다").
//! 실행기가 PLAYING 을 찍은 때는 afplay 를 띄운 때일 뿐이다. 실측(.shots/tabs-glow): 기본 출력 장치가 돌기 시작하기까지 95~237ms,
//! 그 뒤 장치가 알리는 출력 지연이 블루투스 이어폰 322ms·맥북 스피커 25ms — 빛이 소리보다 0.12~0.56초 먼저 났다.
//! 그래서 장치가 돌기 시작한 때를 CoreAudio 로 보고, 장치가 알리는 출력 지연을 더한다. 맥이 아니면 예전처럼 PLAYING 시각 그대로

/// 장치가 이미 다른 소리로 돌고 있어 시작을 못 잴 때 — afplay 를 띄운 뒤 장치가 도는 데 걸린 시간의 가운데 값(실측 95~131ms, 가끔 237ms)
pub(crate) const AFPLAY_START_MS: u64 = 110;
/// 끝난 뒤 빛을 더 남기는 상한 — 잘못 잰 값으로 빛이 오래 남지 않게
const LINGER_CAP_MS: u64 = 1000;

/// 기본 출력 장치를 PLAYING 순간에 본 것 — 출력 지연(ms)과 그때 이미 돌고 있었나
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct OutProbe {
    pub out_ms: u64,
    pub was_running: bool,
    #[allow(dead_code)] // 맥이 아니면 안 읽는다
    pub dev: u32,
}

/// 소리가 귀에 닿는 시각(유닉스 ms). probe 가 없으면(맥 아님·못 읽음) PLAYING 시각 그대로.
/// io_ms = 장치가 돌기 시작한 시각(못 쟀으면 띄운 때 + AFPLAY_START_MS)
pub(crate) fn sound_at(playing_ms: u64, probe: Option<OutProbe>, io_ms: Option<u64>) -> u64 {
    match probe {
        None => playing_ms,
        Some(p) => io_ms.unwrap_or(playing_ms + AFPLAY_START_MS) + p.out_ms,
    }
}

/// 실행기가 끝난 뒤 빛을 얼마나 더 남기나(ms) — afplay 는 마지막 조각을 장치에 넘기면 끝나서, 출력 지연만큼 소리가 더 난다.
/// 곡선이 있으면 소리 끝 = 시작 + 곡선 길이, 없으면 지금 + 출력 지연
pub(crate) fn linger_ms(now_ms: u64, started_ms: u64, env_len: Option<usize>, hop_ms: u32, probe: Option<OutProbe>) -> u64 {
    let end = match (env_len, probe) {
        (Some(n), _) => started_ms + n as u64 * hop_ms as u64,
        (None, Some(p)) => now_ms + p.out_ms,
        (None, None) => now_ms,
    };
    end.saturating_sub(now_ms).min(LINGER_CAP_MS)
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;
    #[repr(C)]
    struct Addr {
        sel: u32,
        scope: u32,
        elem: u32,
    }
    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyData(obj: u32, addr: *const Addr, qsize: u32, q: *const c_void, size: *mut u32, data: *mut c_void) -> i32;
    }
    const fn fcc(s: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*s)
    }
    const SYSTEM: u32 = 1;
    const GLOB: u32 = fcc(b"glob");
    const OUTP: u32 = fcc(b"outp");

    fn get<T: Copy + Default>(obj: u32, sel: &[u8; 4], scope: u32) -> Option<T> {
        let addr = Addr { sel: fcc(sel), scope, elem: 0 };
        let mut v = T::default();
        let mut n = std::mem::size_of::<T>() as u32;
        // SAFETY: 크기를 알려 준 칸 하나에 CoreAudio 가 값을 쓴다
        let err = unsafe { AudioObjectGetPropertyData(obj, &addr, 0, std::ptr::null(), &mut n, &mut v as *mut T as *mut c_void) };
        (err == 0).then_some(v)
    }

    fn stream_latency(dev: u32) -> u32 {
        let addr = Addr { sel: fcc(b"stm#"), scope: OUTP, elem: 0 };
        let mut ids = [0u32; 8];
        let mut n = std::mem::size_of_val(&ids) as u32;
        // SAFETY: 8칸 배열 크기를 알려 주고 받는다
        let err = unsafe { AudioObjectGetPropertyData(dev, &addr, 0, std::ptr::null(), &mut n, ids.as_mut_ptr() as *mut c_void) };
        if err != 0 {
            return 0;
        }
        ids[..(n as usize / 4).min(8)].iter().filter_map(|&s| get::<u32>(s, b"ltnc", GLOB)).max().unwrap_or(0)
    }

    pub(super) fn probe() -> Option<super::OutProbe> {
        let dev = get::<u32>(SYSTEM, b"dOut", GLOB).filter(|&d| d != 0)?;
        let rate = get::<f64>(dev, b"nsrt", GLOB).filter(|r| *r > 0.0)?;
        let frames = get::<u32>(dev, b"ltnc", OUTP).unwrap_or(0) as u64
            + get::<u32>(dev, b"saft", OUTP).unwrap_or(0) as u64
            + get::<u32>(dev, b"fsiz", GLOB).unwrap_or(0) as u64
            + stream_latency(dev) as u64;
        Some(super::OutProbe { out_ms: (frames as f64 / rate * 1000.0).round() as u64, was_running: running(dev), dev })
    }

    pub(super) fn running(dev: u32) -> bool {
        get::<u32>(dev, b"gone", GLOB).is_some_and(|v| v != 0)
    }
}

/// 지금 기본 출력 장치 — 맥에서만. 시험에선 진짜 장치를 안 본다(실측 시험만 CHAMMO_AUDIO_PROBE=1)
pub(crate) fn probe() -> Option<OutProbe> {
    if cfg!(test) && std::env::var_os("CHAMMO_AUDIO_PROBE").is_none() {
        return None;
    }
    #[cfg(target_os = "macos")]
    return mac::probe();
    #[cfg(not(target_os = "macos"))]
    None
}

/// 장치가 돌기 시작한 시각(유닉스 ms) — 이미 돌고 있었으면(다른 소리) 못 잰다. 2ms 마다, 최대 wait_ms
pub(crate) fn wait_io_start(p: OutProbe, wait_ms: u64, now_ms: impl Fn() -> u64, keep: impl Fn() -> bool) -> Option<u64> {
    if p.was_running {
        return None;
    }
    #[cfg(target_os = "macos")]
    {
        let t0 = now_ms();
        while now_ms() < t0 + wait_ms && keep() {
            if mac::running(p.dev) {
                return Some(now_ms());
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }
    let _ = (wait_ms, &now_ms, &keep);
    None
}

/// 실측 시험이 따로 장치를 지켜보게
#[cfg(all(test, target_os = "macos"))]
pub(crate) fn running(dev: u32) -> bool {
    mac::running(dev)
}

#[cfg(test)]
mod tests {
    use super::*;
    const BT: OutProbe = OutProbe { out_ms: 322, was_running: false, dev: 1 };

    #[test]
    fn 맥이_아니거나_장치를_못_읽으면_playing_시각_그대로() {
        assert_eq!(sound_at(10_000, None, None), 10_000);
        assert_eq!(sound_at(10_000, None, Some(10_100)), 10_000);
    }

    #[test]
    fn 장치가_돌기_시작한_때에_출력_지연을_더한다() {
        // 실측: 블루투스 이어폰 — 띄우고 100ms 뒤 장치가 돌고, 322ms 뒤 귀에
        assert_eq!(sound_at(10_000, Some(BT), Some(10_100)), 10_422);
    }

    #[test]
    fn 장치가_이미_돌고_있어_시작을_못_재면_어림값() {
        assert_eq!(sound_at(10_000, Some(BT), None), 10_000 + AFPLAY_START_MS + 322);
    }

    #[test]
    fn 끝난_뒤_곡선이_끝날_때까지_빛을_남긴다() {
        // 곡선 40칸 × 25ms = 1초, 소리는 5,000 에 닿았다 → 5,800 에 실행기가 끝나도 6,000 까지
        assert_eq!(linger_ms(5_800, 5_000, Some(40), 25, Some(BT)), 200);
        assert_eq!(linger_ms(6_100, 5_000, Some(40), 25, Some(BT)), 0, "이미 지났으면 0");
        assert_eq!(linger_ms(5_800, 5_000, None, 25, Some(BT)), 322, "곡선이 없으면 출력 지연만큼");
        assert_eq!(linger_ms(5_800, 5_000, None, 25, None), 0, "맥이 아니면 예전처럼 바로 끝");
        assert_eq!(linger_ms(1_000, 9_000, Some(400), 25, None), LINGER_CAP_MS, "잘못 잰 값이어도 1초 넘게 안 남는다");
    }

    #[test]
    fn 이미_돌고_있던_장치는_기다리지_않는다() {
        let p = OutProbe { was_running: true, ..BT };
        assert_eq!(wait_io_start(p, 600, || 0, || true), None);
    }
}

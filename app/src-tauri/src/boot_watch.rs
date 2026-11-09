//! 앱 시작이 어디까지 갔나 — 단계마다 표시하고, 시작이 안 끝나면 notify.log 에 그 단계와 메인 스레드 스택(boot-stall.txt)을 남긴다.
//! 2026-11-04: 앱이 113분 동안 시작을 못 끝냈는데(메뉴 만들다 ~/Desktop stat 이 맥 폴더 권한 창에 걸림) 기록이 한 줄도 없어 macOS 로그로 거꾸로 찾아야 했다.
//! 끝나면 걸린 시간 한 줄(시작이 느려지는 걸 알아채게). 앱을 끄거나 고치진 않는다 — 어디서 왜 멈췄는지 남기는 일만
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct State {
    stage: &'static str,
    at: Instant,
    done: bool,
    stalled: bool,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

/// 멈췄다고 적을 다음 때(초) — 20초·1분·5분, 그 뒤 30분마다
pub fn next_report(after_s: u64) -> u64 {
    match after_s {
        0..=19 => 20,
        20..=59 => 60,
        60..=299 => 300,
        _ => (after_s / 1800 + 1) * 1800,
    }
}

pub fn start() {
    *STATE.lock().unwrap() = Some(State { stage: "main", at: Instant::now(), done: false, stalled: false });
    std::thread::spawn(watch);
}

pub fn mark(stage: &'static str) {
    if let Some(s) = STATE.lock().unwrap().as_mut() {
        s.stage = stage;
    }
}

pub fn done() {
    let Some((secs, stalled)) = STATE.lock().unwrap().as_mut().map(|s| {
        s.done = true;
        (s.at.elapsed().as_secs_f32(), s.stalled)
    }) else { return };
    crate::claude::log_out("boot", &format!("done in {secs:.1}s{}", if stalled { " (stalled, see boot-stall.txt)" } else { "" }));
}

fn watch() {
    let mut due = next_report(0);
    let mut sampled = false;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let Some((stage, after)) = ({
            let mut g = STATE.lock().unwrap();
            g.as_mut().and_then(|s| {
                if s.done { return None; }
                let after = s.at.elapsed().as_secs();
                if after >= due { s.stalled = true; }
                Some((s.stage, after))
            })
        }) else { return };
        if after < due {
            continue;
        }
        due = next_report(after);
        crate::claude::log_out("boot", &format!("STALLED {after}s at {stage}"));
        // 스택은 처음과 5분째 — 잠깐 느린 것과 오래 걸린 것이 같은 자리인지 본다
        if !sampled || after >= 300 {
            sample();
            sampled = after >= 300;
        }
    }
}

#[cfg(target_os = "macos")]
fn sample() {
    let out = crate::config::data_file("boot-stall.txt");
    let mut cmd = crate::platform::command("/usr/bin/sample");
    cmd.arg(std::process::id().to_string()).arg("2").arg("-file").arg(&out);
    if let Err(e) = crate::platform::run_capped(&mut cmd, Duration::from_secs(30)) {
        crate::claude::log_out("boot", &format!("sample failed: {e}"));
    }
}

#[cfg(not(target_os = "macos"))]
fn sample() {}

#[cfg(test)]
mod tests {
    use super::next_report;

    #[test]
    fn 멈춤은_20초_1분_5분_뒤엔_30분마다_적는다() {
        assert_eq!(next_report(0), 20);
        assert_eq!(next_report(19), 20);
        assert_eq!(next_report(20), 60);
        assert_eq!(next_report(60), 300);
        assert_eq!(next_report(300), 1800);
        assert_eq!(next_report(1800), 3600);
        assert_eq!(next_report(6780), 7200);
    }
}

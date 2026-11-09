use super::*;
use std::sync::{Arc, Mutex as M};

fn tmpd(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chammo-tmedia-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// 시작한 일을 바로 안 돌리고 모아 둔다 — 시험이 원할 때 돌린다
#[derive(Clone, Default)]
struct Later(Arc<M<Vec<Box<dyn FnOnce() + Send>>>>);
impl Later {
    fn spawn(&self) -> impl FnOnce(Box<dyn FnOnce() + Send>) + '_ {
        move |f| self.0.lock().unwrap().push(f)
    }
    fn run_all(&self) {
        let v: Vec<_> = std::mem::take(&mut *self.0.lock().unwrap());
        for f in v {
            f();
        }
    }
}

fn work(r: Result<PathBuf, String>) -> Result<Work, String> {
    Ok(Box::new(move || r))
}

#[test]
fn 처음_누르면_뒤에서_받기_시작하고_받는_동안_다시_안_시작한다() {
    let d = tmpd("start");
    let p = d.join("영상.mp4");
    std::fs::write(&p, b"v").unwrap();
    let later = Later::default();
    let starts = M::new(0);
    let go = || {
        poll("tm-a", "f1", || { *starts.lock().unwrap() += 1; work(Ok(p.clone())) }, later.spawn()).unwrap()
    };
    assert_eq!(go(), Step::Going { done: 0, total: 0 });
    assert_eq!(go(), Step::Going { done: 0, total: 0 }, "받는 중엔 그대로");
    assert_eq!(*starts.lock().unwrap(), 1, "두 번 눌러도 한 번만 받는다");
    later.run_all();
    assert_eq!(go(), Step::Ready(p.clone()));
    assert_eq!(go(), Step::Ready(p.clone()), "다 받은 건 다시 안 받는다");
    assert_eq!(*starts.lock().unwrap(), 1);
}

#[test]
fn 받는_진행은_데스크톱_열기와_같은_team_down_줄에서() {
    let d = tmpd("prog");
    let p = d.join("큰.mp4");
    std::fs::write(&p, b"v").unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let rx = M::new(Some(rx));
    let p2 = p.clone();
    let step = poll(
        "tm-b",
        "f2",
        || {
            let rx = rx.lock().unwrap().take().unwrap();
            Ok(Box::new(move || crate::team_down::track("tm-b", "f2", "open", |tick| {
                tick(30, 100)?;
                rx.recv().unwrap();
                Ok(p2)
            })))
        },
        |f| {
            std::thread::spawn(f);
        },
    )
    .unwrap();
    assert!(matches!(step, Step::Going { .. }));
    let mut seen = Step::Going { done: 0, total: 0 };
    for _ in 0..200 {
        seen = poll("tm-b", "f2", || Err("다시 시작하면 안 된다".into()), |_| {}).unwrap();
        if seen == (Step::Going { done: 30, total: 100 }) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(seen, Step::Going { done: 30, total: 100 });
    tx.send(()).unwrap();
    for _ in 0..200 {
        seen = poll("tm-b", "f2", || Err("다시 시작하면 안 된다".into()), |_| {}).unwrap();
        if seen == Step::Ready(p.clone()) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(seen, Step::Ready(p));
}

#[test]
fn 실패는_까닭과_한_번_알리고_다시_누르면_처음부터() {
    let later = Later::default();
    let starts = M::new(0);
    let go = |r: Result<PathBuf, String>| poll("tm-c", "f3", || { *starts.lock().unwrap() += 1; work(r) }, later.spawn()).unwrap();
    go(Err("중계 서버에 못 닿았어요".into()));
    later.run_all();
    assert_eq!(go(Ok(PathBuf::new())), Step::Failed { why: "net".into(), error: "중계 서버에 못 닿았어요".into() });
    assert_eq!(*starts.lock().unwrap(), 1, "실패를 알리는 부름은 새로 안 시작한다");
    assert_eq!(go(Err("그 파일이 없어(지워졌거나 볼 수 없는 방)".into())), Step::Going { done: 0, total: 0 }, "다음 누름은 처음부터");
    later.run_all();
    assert!(matches!(go(Ok(PathBuf::new())), Step::Failed { why, .. } if why == "gone"));
}

#[test]
fn 풀어_둔_파일이_청소로_지워졌으면_다시_받는다() {
    let d = tmpd("swept");
    let p = d.join("a.mp4");
    std::fs::write(&p, b"v").unwrap();
    let later = Later::default();
    let starts = M::new(0);
    let go = || poll("tm-d", "f4", || { *starts.lock().unwrap() += 1; work(Ok(p.clone())) }, later.spawn()).unwrap();
    go();
    later.run_all();
    assert_eq!(go(), Step::Ready(p.clone()));
    std::fs::remove_file(&p).unwrap();
    assert_eq!(go(), Step::Going { done: 0, total: 0 });
    assert_eq!(*starts.lock().unwrap(), 2);
}

#[test]
fn 시작을_거절하면_기록_없이_그_까닭() {
    let later = Later::default();
    assert_eq!(poll("tm-e", "f5", || Err("영상만 폰에서 튼다".into()), later.spawn()), Err("영상만 폰에서 튼다".into()));
    assert!(later.0.lock().unwrap().is_empty());
    assert_eq!(poll("tm-e", "f5", || work(Ok(PathBuf::new())), later.spawn()).unwrap(), Step::Going { done: 0, total: 0 }, "거절은 남지 않는다");
}

#[test]
fn 데스크톱이_같은_파일을_여는_중이면_끝날_때까지_기다린다() {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let t = std::thread::spawn(move || crate::team_down::track("tm-f", "f6", "open", |_| {
        rx.recv().unwrap();
        Ok(PathBuf::from("/x"))
    }));
    for _ in 0..200 {
        if busy("tm-f", "f6") {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(busy("tm-f", "f6"));
    assert!(!busy("tm-f", "f7"), "다른 파일");
    tx.send(()).unwrap();
    t.join().unwrap().unwrap();
    assert!(!busy("tm-f", "f6"));
}

#[cfg(unix)]
#[test]
fn 받은_평문은_나만_읽는_600() {
    use std::os::unix::fs::PermissionsExt;
    let d = tmpd("mode");
    let p = d.join("a.mp4");
    std::fs::write(&p, b"v").unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
    crate::team_locker_app::private_file(&p);
    assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
}

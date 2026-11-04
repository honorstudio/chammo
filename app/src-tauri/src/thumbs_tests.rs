use super::*;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

fn tmp(tag: &str) -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let d = std::env::temp_dir().join(format!("chammo-thumbs-{tag}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn age(p: &Path, secs: u64) {
    std::fs::File::options().append(true).open(p).unwrap().set_modified(SystemTime::now() - Duration::from_secs(secs)).unwrap();
}

#[test]
fn 원본이_바뀌면_이름이_바뀐다() {
    let d = tmp("key");
    let src = d.join("a.pdf");
    std::fs::write(&src, b"one").unwrap();
    age(&src, 100);
    let k1 = key(&src, 480).unwrap();
    assert_eq!(k1, key(&src, 480).unwrap(), "같은 파일·같은 크기면 같은 이름");
    assert_ne!(k1, key(&src, 1600).unwrap(), "크기(px)가 다르면 다른 이름");
    std::fs::write(&src, b"one!").unwrap(); // 길이·수정 시각이 바뀜
    assert_ne!(k1, key(&src, 480).unwrap(), "고친 원본은 새 이름 — 묵은 그림을 안 준다");
    let other = d.join("b").join("a.pdf");
    std::fs::create_dir_all(other.parent().unwrap()).unwrap();
    std::fs::write(&other, b"one").unwrap();
    assert_ne!(key(&src, 480), key(&other, 480), "이름이 같아도 경로가 다르면 다른 이름");
    assert!(key(&d.join("없음.pdf"), 480).is_none());
}

#[test]
fn 한_번_만든_건_다시_안_만든다() {
    let d = tmp("hit");
    let src = d.join("a.pdf");
    std::fs::write(&src, b"x").unwrap();
    let cache = d.join("cache");
    let calls = AtomicUsize::new(0);
    let make = |out: &Path| {
        calls.fetch_add(1, Ordering::SeqCst);
        std::fs::write(out, b"png").map_err(|e| e.to_string())
    };
    let a = cached(&cache, &src, 480, "png", make).unwrap();
    let b = cached(&cache, &src, 480, "png", |_| panic!("또 만들면 안 된다")).unwrap();
    assert_eq!(a, b);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(std::fs::read(&a).unwrap(), b"png");
    // 임시 조각이 안 남는다
    assert!(std::fs::read_dir(&cache).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().contains(".part.")));
}

#[test]
fn 실패도_기억하고_원본이_바뀌면_다시_해_본다() {
    let d = tmp("fail");
    let src = d.join("a.hwpx");
    std::fs::write(&src, b"x").unwrap();
    age(&src, 100);
    let cache = d.join("cache");
    assert!(cached(&cache, &src, 480, "png", |_| Err("20초 끊김".into())).is_err());
    assert!(cached(&cache, &src, 480, "png", |_| panic!("실패한 걸 또 돌리면 안 된다")).is_err());
    // 빈 그림도 실패
    let src2 = d.join("b.pdf");
    std::fs::write(&src2, b"x").unwrap();
    assert!(cached(&cache, &src2, 480, "png", |out| std::fs::write(out, b"").map_err(|e| e.to_string())).is_err());
    assert!(matches!(look(&cache, &key(&src2, 480).unwrap(), "png"), Hit::Failed));
    // 원본을 고치면 새로 해 본다
    std::fs::write(&src, b"xy").unwrap();
    assert!(cached(&cache, &src, 480, "png", |out| std::fs::write(out, b"ok").map_err(|e| e.to_string())).is_ok());
}

#[test]
fn 상한을_넘으면_오래_안_쓴_것부터_지운다() {
    let d = tmp("prune");
    for (i, secs) in [(0, 500), (1, 400), (2, 300), (3, 200)] {
        let p = d.join(format!("k{i}-480.png"));
        std::fs::write(&p, vec![0u8; 100]).unwrap();
        age(&p, secs);
    }
    // 상한 안이면 그대로
    assert_eq!(prune(&d, 400), 0);
    // 가장 오래된 k0 을 방금 썼다(look 이 수정 시각을 당김) → 다음으로 오래된 k1·k2 가 지워진다
    assert!(matches!(look(&d, "k0-480", "png"), Hit::Ready(_)));
    assert_eq!(prune(&d, 250), 200);
    let left: Vec<String> = std::fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert!(left.contains(&"k0-480.png".to_string()) && left.contains(&"k3-480.png".to_string()), "{left:?}");
    assert_eq!(left.len(), 2, "{left:?}");
}

#[test]
fn 하루_지난_실패_표시와_남은_조각은_치운다() {
    let d = tmp("junk");
    let (f_old, f_new, part) = (d.join("a-480.fail"), d.join("b-480.fail"), d.join(".c-480-1-2.part.png"));
    for p in [&f_old, &f_new, &part] {
        std::fs::write(p, b"").unwrap();
    }
    age(&f_old, 2 * 24 * 3600);
    age(&part, 2 * 24 * 3600);
    prune(&d, CAP);
    assert!(!f_old.exists() && !part.exists());
    assert!(f_new.exists(), "어제 안의 실패 표시는 남긴다(바로 또 20초 헛돌지 않게)");
}

#[test]
fn 만들기는_동시에_둘까지만() {
    let gate = Arc::new(Gate::new(MAX_MAKERS));
    let (now, peak) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
    let hs: Vec<_> = (0..8)
        .map(|_| {
            let (gate, now, peak) = (gate.clone(), now.clone(), peak.clone());
            std::thread::spawn(move || {
                gate.run(|| {
                    let n = now.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(n, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(40));
                    now.fetch_sub(1, Ordering::SeqCst);
                })
            })
        })
        .collect();
    for h in hs {
        h.join().unwrap();
    }
    assert_eq!(peak.load(Ordering::SeqCst), 2);
}

#[test]
fn 만들다_패닉해도_자리를_돌려준다() {
    let gate = Arc::new(Gate::new(1));
    let g = gate.clone();
    let _ = std::thread::spawn(move || g.run(|| panic!("변환기 패닉"))).join();
    // 자리가 안 돌아왔으면 여기서 영영 멈춘다
    let (tx, rx) = std::sync::mpsc::channel();
    let g = gate.clone();
    std::thread::spawn(move || {
        g.run(|| ());
        let _ = tx.send(());
    });
    assert!(rx.recv_timeout(Duration::from_secs(2)).is_ok());
}

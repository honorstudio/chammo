//! 웹 화면 지킴이 판단 — 언제 무엇을 끝내나(web_watch.rs). 11-06 그날 숫자와 재현 값으로
use super::*;

const S: Duration = Duration::from_secs(1);

fn started(visible: bool) -> (Watch, Instant) {
    let (mut w, t) = (Watch::default(), Instant::now());
    w.beat("main", visible, t);
    w.tick(t, 1);
    (w, t)
}

/// 5초마다 돌리고 나온 일을 모은다 — 감시 스레드와 같게(시계 튐으로 안 보이게)
fn run(w: &mut Watch, from: Instant, secs: u64, slack: u32) -> Vec<(u64, Act)> {
    let mut out = Vec::new();
    let mut at = 5;
    while at <= secs {
        for a in w.tick(from + S * at as u32, slack) {
            out.push((at, a));
        }
        at += 5;
    }
    out
}

#[test]
fn 숨을_쉬는_창은_아무_일_없다() {
    let (mut w, t) = started(true);
    for i in 1..20u32 {
        w.beat("main", true, t + S * (i * 5));
        assert!(w.tick(t + S * (i * 5), 1).is_empty());
    }
}

#[test]
fn 끊기면_20초에_gpu_15초_뒤_web_process() {
    let (mut w, t) = started(true);
    assert_eq!(run(&mut w, t, 35, 1), vec![(20, Act::Gpu("main".into())), (35, Act::Restart("main".into()))]);
}

#[test]
fn 그래도_안_돌아오면_뜸을_늘려_계속한다() {
    let (mut w, t) = started(true);
    let at: Vec<u64> = run(&mut w, t, 2200, 1).into_iter().filter(|(_, a)| matches!(a, Act::Restart(_))).map(|(s, _)| s).collect();
    assert_eq!(&at[..4], &[35, 95, 215, 455]);
    assert_eq!(at.windows(2).last().map(|p| p[1] - p[0]), Some(600), "10분에서 멈춘다");
}

#[test]
fn 돌아오면_끊겼던_초를_알려_주고_처음부터() {
    let (mut w, t) = started(true);
    run(&mut w, t, 20, 1);
    assert_eq!(w.beat("main", true, t + S * 22), Some(22));
    assert_eq!(w.beat("main", true, t + S * 23), None, "한 번만");
    assert!(w.tick(t + S * 25, 1).is_empty());
}

#[test]
fn 가려진_창은_조용해도_건드리지_않는다() {
    let (mut w, t) = started(false);
    assert!(run(&mut w, t, 300, 1).is_empty());
}

#[test]
fn 가려지면_거기서_멈추고_숨_쉰_적_없는_창은_모른다() {
    let (mut w, t) = started(true);
    w.beat("main", false, t + S);
    assert!(run(&mut w, t, 300, 1).is_empty());
    assert!(!w.focused("밖 주소", t), "바깥 주소 창");
    assert!(w.tick(t + S * 305, 1).is_empty());
}

#[test]
fn 앞으로_왔는데_답이_없으면_그때부터_잰다() {
    let (mut w, t) = started(false);
    run(&mut w, t, 100, 1);
    assert!(w.focused("main", t + S * 100));
    assert_eq!(run_from(&mut w, t, 105, 120), vec![(120, Act::Gpu("main".into()))]);
}

#[test]
fn 앞으로_왔을_때_바로_답하면_가려진_그대로() {
    let (mut w, t) = started(false);
    run(&mut w, t, 100, 1);
    w.focused("main", t + S * 100);
    w.beat("main", false, t + S * 100);
    assert!(run_from(&mut w, t, 105, 300).is_empty());
}

fn run_from(w: &mut Watch, from: Instant, a: u64, b: u64) -> Vec<(u64, Act)> {
    let mut out = Vec::new();
    let mut at = a;
    while at <= b {
        for x in w.tick(from + S * at as u32, 1) {
            out.push((at, x));
        }
        at += 5;
    }
    out
}

#[test]
fn 잠자기나_과부하로_시계가_튀면_다시_센다() {
    let (mut w, t) = started(true);
    assert!(w.tick(t + S * 3600, 1).is_empty());
    assert!(w.tick(t + S * 3605, 1).is_empty(), "깬 직후 조용한 건 죽은 게 아니다");
}

#[test]
fn 맥이_바쁘면_기다림이_두_배() {
    let (mut w, t) = started(true);
    assert_eq!(run(&mut w, t, 70, 2), vec![(40, Act::Gpu("main".into())), (70, Act::Restart("main".into()))]);
}

#[test]
fn 다시_불러오는_창은_뜰_시간을_준다() {
    let (mut w, t) = started(true);
    run(&mut w, t, 15, 1);
    w.reloading("main", t + S * 15);
    assert!(run_from(&mut w, t, 20, 30).is_empty());
}

#[test]
fn 되살리던_중_다시_불러와도_끊긴_시간은_처음부터_잰다() {
    let (mut w, t) = started(true);
    run(&mut w, t, 35, 1);
    w.reloading("main", t + S * 35);
    assert_eq!(w.beat("main", true, t + S * 38), Some(38));
}

#[test]
fn 닫은_창은_잊는다() {
    let (mut w, t) = started(true);
    w.forget("main");
    assert!(run(&mut w, t, 100, 1).is_empty());
}

#[test]
fn gpu_번호가_그대로면_할_일_없다() {
    let (mut g, t) = (GpuWatch::default(), Instant::now());
    for i in 0..5u32 {
        assert_eq!(g.see(77, |_| true, t + S * (i * 5)), None);
    }
}

#[test]
fn 번호가_0_이_됐는데_살아_있으면_10초_뒤_끝낸다_11_06_그날() {
    let (mut g, t) = (GpuWatch::default(), Instant::now());
    g.see(74521, |_| true, t);
    assert_eq!(g.see(0, |_| true, t + S * 5), None);
    assert_eq!(g.see(0, |_| true, t + S * 10), None);
    assert_eq!(g.see(0, |_| true, t + S * 15), Some(74521));
    assert_eq!(g.see(0, |_| true, t + S * 20), None, "한 번만");
}

#[test]
fn 새_번호가_떴어도_옛_gpu_가_살아_있으면_끝내고_새_번호를_본다() {
    let (mut g, t) = (GpuWatch::default(), Instant::now());
    g.see(10, |_| true, t);
    g.see(20, |p| p == 10, t + S * 5);
    assert_eq!(g.see(20, |p| p == 10, t + S * 15), Some(10));
    assert_eq!(g.see(20, |p| p == 10, t + S * 40), None);
}

#[test]
fn 스스로_나간_gpu_는_건드리지_않는다_평소() {
    let (mut g, t) = (GpuWatch::default(), Instant::now());
    g.see(10, |_| true, t);
    assert_eq!(g.see(0, |_| false, t + S * 5), None);
    assert_eq!(g.see(0, |_| false, t + S * 60), None);
    assert_eq!(g.see(30, |_| false, t + S * 65), None);
    assert_eq!(g.see(30, |_| false, t + S * 70), None);
}

#[test]
fn 잠깐_0_이었다_돌아오면_없던_일() {
    let (mut g, t) = (GpuWatch::default(), Instant::now());
    g.see(10, |_| true, t);
    g.see(0, |_| true, t + S * 5);
    assert_eq!(g.see(10, |_| true, t + S * 10), None);
    g.see(0, |_| true, t + S * 15);
    assert_eq!(g.see(0, |_| true, t + S * 20), None, "기다림도 처음부터");
}

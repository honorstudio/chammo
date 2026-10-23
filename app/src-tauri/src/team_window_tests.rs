use super::*;

fn scr(name: &str, x: i32, w: u32) -> Screen {
    Screen { name: name.into(), x, y: 0, w, h: 1000 }
}

#[test]
fn 창_열쇠는_all_또는_방_id_만() {
    assert!(key_ok("all") && key_ok("r-1_A"));
    assert!(!key_ok("") && !key_ok("../x") && !key_ok("a b") && !key_ok(&"a".repeat(65)));
    assert_eq!(label("all"), "team-all");
}

#[test]
fn 기억한_자리는_그_모니터가_있을_때만_살아_있다() {
    let s = Spot { monitor: "LG".into(), x: 1700, y: 100, w: 900, h: 600 };
    assert!(spot_alive(&s, &[scr("맥북", 0, 1512), scr("LG", 1512, 2560)]));
    assert!(!spot_alive(&s, &[scr("맥북", 0, 1512)]), "모니터를 뺐다");
    assert!(!spot_alive(&s, &[scr("맥북", 0, 1512), scr("LG", 1512, 100)]), "이름은 같아도 자리가 그 안에 없다");
}

#[test]
fn 처음_떼면_메인_창이_없는_모니터_가운데() {
    let screens = [scr("맥북", 0, 1512), scr("LG", 1512, 2560)];
    let (x, y, w, h) = place(None, &screens, (100, 100));
    assert!(x >= 1512 && x + w as i32 <= 1512 + 2560, "{x}");
    assert_eq!((w, h), (DEFAULT_W, DEFAULT_H));
    assert_eq!(y, (1000 - DEFAULT_H as i32) / 2);
    // 메인 창이 LG 에 있으면 맥북 쪽
    let (x, ..) = place(None, &screens, (2000, 100));
    assert!(x < 1512);
}

#[test]
fn 기억한_자리가_살아_있으면_그대로_모니터가_없으면_새로() {
    let screens = [scr("맥북", 0, 1512), scr("LG", 1512, 2560)];
    let s = Spot { monitor: "LG".into(), x: 1600, y: 50, w: 700, h: 500 };
    assert_eq!(place(Some(&s), &screens, (0, 0)), (1600, 50, 700, 500));
    let one = [scr("맥북", 0, 1512)];
    let (x, _, w, _) = place(Some(&s), &one, (0, 0));
    assert!(x >= 0 && x + w as i32 <= 1512, "모니터 하나면 메인 창 화면 안");
}

#[test]
fn 작은_화면에선_창을_화면에_맞춘다() {
    let (x, _, w, h) = place(None, &[Screen { name: "작은".into(), x: 0, y: 0, w: 800, h: 600 }], (0, 0));
    assert!(w <= 760 && h <= 520 && x >= 0);
}

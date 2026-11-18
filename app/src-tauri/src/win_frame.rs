//! 메인 창 크기·자리 기억 — 끌 때 크기로 다음에 처음부터 뜬다(<데이터 폴더>/window.json).
//! 11-18 사용자 "좁게 있다가 펼쳐짐": 앱은 늘 1440×900 으로 뜨고 사람이 꽉 채우면(1920×1050) 그제야 커졌는데, 켜는 중엔 웹뷰가
//! 새 크기로 다시 그리는 데 몇 초가 걸려 오른쪽·아래가 하얗게 비었다. 처음부터 그 크기로 만들면 켠 뒤 창 크기가 바뀔 일이 없다.
//! - 크기는 Tauri inner_size(논리) — 설정 파일 width/height 와 같은 값(맥 26 은 제목줄 포함 틀이라 둘이 같은 뜻, 시험으로 왕복 확인). 자리는 바깥 틀 왼쪽 위(논리)
//! - 다시 쓸 땐 지금 화면들에 맞춘다: 제목줄이 어느 화면에도 없으면 자리는 버리고(가운데), 크기는 그 화면보다 크면 줄인다
//! - 전체 화면·최소화·첫 설치 창(640×440)은 안 적는다 — 최소 크기(1024×640)보다 작은 값은 안 읽는다
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub const MIN: (f64, f64) = (1024.0, 640.0);
/// 윈도우는 끈다(0.4.16 윈도우 실기 11-18) — 저장은 메뉴줄을 뺀 inner_size 인데 설정 height 는 메뉴줄을 포함해서 켤 때마다 20px 씩 줄었고,
/// 화면 목록(vdisplay)이 비어 자리도 늘 버렸다. 메뉴줄 높이·화면 목록을 윈도우 값으로 맞추고 실기로 본 뒤 켠다(roadmap 부채)
pub const ON: bool = !cfg!(target_os = "windows");
const FILE: &str = "window.json";

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Default, Serialize, Deserialize)]
struct Store {
    main: Option<Frame>,
    /// 윈도우 최대화 — 틀은 최대화 전 것을 두고 이 표시로 다시 최대화(맥은 꽉 채운 틀 자체를 둔다)
    #[serde(default)]
    max: bool,
}

/// 화면 네모(논리, 위 왼쪽 기준) — (x, y, w, h)
pub type Screen = (f64, f64, f64, f64);

/// 저장값 → 이번에 쓸 (크기, 자리). 자리 None = 가운데. 값이 이상하면 None(설정 파일 기본값 그대로)
pub fn fit(f: Frame, screens: &[Screen]) -> Option<((f64, f64), Option<(f64, f64)>)> {
    if ![f.x, f.y, f.w, f.h].iter().all(|v| v.is_finite()) || f.w < MIN.0 || f.h < MIN.1 || f.w > 20000.0 || f.h > 20000.0 {
        return None;
    }
    // 제목줄(위 30pt)이 가장 많이 걸친 화면 — 100×30 넘게 걸쳐야 잡을 수 있다
    let bar = |s: &Screen| {
        let w = (f.x + f.w).min(s.0 + s.2) - f.x.max(s.0);
        let h = (f.y + 30.0).min(s.1 + s.3) - f.y.max(s.1);
        if w > 0.0 && h > 0.0 { w * h } else { 0.0 }
    };
    let on = screens.iter().copied().filter(|s| bar(s) >= 100.0 * 30.0).max_by(|a, b| bar(a).total_cmp(&bar(b)));
    let cap = on.or_else(|| screens.first().copied());
    let (w, h) = match cap {
        Some(s) => (f.w.min(s.2).max(MIN.0.min(s.2)), f.h.min(s.3).max(MIN.1.min(s.3))),
        None => (f.w, f.h),
    };
    Some(((w, h), on.map(|_| (f.x, f.y))))
}

fn path() -> std::path::PathBuf {
    crate::config::data_file(FILE)
}

fn read() -> Store {
    std::fs::read_to_string(path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn screens() -> Vec<Screen> {
    crate::vdisplay::visible_displays().into_iter().map(|(r, _)| (r.x, r.y, r.w, r.h)).collect()
}

/// 설정 파일의 메인 창을 지난번 크기·자리로 — 창이 생기기 전(generate_context 바로 뒤)에. 시험판 화면 밖 자리는 test_window::prepare 가 뒤에서 덮는다
pub fn prepare(ctx: &mut tauri::Context<tauri::Wry>) {
    if !ON {
        return;
    }
    let st = read();
    let Some(((w, h), at)) = st.main.and_then(|f| fit(f, &screens())) else { return };
    for c in ctx.config_mut().app.windows.iter_mut().filter(|c| c.label == "main") {
        c.maximized = st.max && !cfg!(target_os = "macos");
        c.width = w;
        c.height = h;
        if let Some((x, y)) = at {
            c.x = Some(x);
            c.y = Some(y);
            c.center = false;
        }
    }
}

static PENDING: Mutex<Option<(Option<Frame>, bool)>> = Mutex::new(None);

/// 메인 창이 움직이거나 크기가 바뀌면(on_window_event) — 0.5초 조용하면 한 번 적는다(끄는 동안 여러 번 와도). 파일 쓰기는 메인 스레드 밖
pub fn changed<R: tauri::Runtime>(w: &tauri::Window<R>) {
    if !ON || w.label() != "main" || w.is_fullscreen().unwrap_or(false) || w.is_minimized().unwrap_or(false) || !w.is_resizable().unwrap_or(true) {
        return;
    }
    // 윈도우 최대화는 틀을 안 바꾸고 표시만(풀면 그 전 크기로 돌아가게). 맥의 꽉 채우기는 그 틀째 둔다
    let max = !cfg!(target_os = "macos") && w.is_maximized().unwrap_or(false);
    let f = if max {
        None
    } else {
        let (Ok(s), Ok(sz), Ok(at)) = (w.scale_factor(), w.inner_size(), w.outer_position()) else { return };
        let (sz, at) = (sz.to_logical::<f64>(s), at.to_logical::<f64>(s));
        let f = Frame { x: at.x, y: at.y, w: sz.width, h: sz.height };
        if f.w < MIN.0 || f.h < MIN.1 {
            return; // 첫 설치 창
        }
        Some(f)
    };
    let first = {
        let mut p = PENDING.lock().unwrap_or_else(|e| e.into_inner());
        let first = p.is_none();
        *p = Some((f, max));
        first
    };
    if first {
        std::thread::spawn(|| loop {
            let a = *PENDING.lock().unwrap_or_else(|e| e.into_inner());
            std::thread::sleep(std::time::Duration::from_millis(500));
            let mut p = PENDING.lock().unwrap_or_else(|e| e.into_inner());
            if *p == a {
                if let Some((f, max)) = p.take() {
                    let main = f.or_else(|| read().main); // 최대화면 옛 틀 그대로
                    let _ = crate::accounts::write_atomic(&path(), &serde_json::to_string(&Store { main, max }).unwrap_or_default());
                }
                return;
            }
        });
    }
}

/// 맥 최대화(초록 단추·제목줄 더블클릭)를 애니메이션 없이 한 번에 — 11-18 사용자 "최대화 할 때 한번 버벅거려".
/// zoom 은 setFrame:display:animate: 로 약 0.35초 애니메이션을 메인 스레드에서 돌리는데, 그동안 웹뷰는 새 그림을 못 받아
/// 옛 크기로 왼쪽 위에 남고 나머지가 흰 칸이었다(시험판 실측: 애니메이션 355ms 내내 rAF 0, 끝나고 20ms 뒤에야 새 폭).
/// 앱 창 클래스(TaoWindow — 메인·모드·리더·메신저·메모 창이 다 이 클래스)에 animationResizeTime: = 0 을 붙인다. setup 에서 한 번(메인 스레드)
#[cfg(target_os = "macos")]
pub fn instant_zoom<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    let Some(w) = app.get_webview_window("main") else { return };
    let Ok(ns) = w.ns_window() else { return };
    unsafe {
        // 이름으로 먼저 — 창 하나에 KVO 하위 클래스가 붙어 있으면 그 창만 바뀐다
        let cls = objc2::runtime::AnyClass::get(c"TaoWindow")
            .map(|c| c as *const objc2::runtime::AnyClass as *mut objc2::runtime::AnyClass)
            .unwrap_or_else(|| objc2::ffi::object_getClass(ns as *mut objc2::runtime::AnyObject) as *mut _);
        no_resize_animation(cls);
    }
}

/// 이 창 클래스의 animationResizeTime: 을 0 으로 — 붙였으면 true(이미 이 클래스에 있으면 false)
#[cfg(target_os = "macos")]
pub unsafe fn no_resize_animation(cls: *mut objc2::runtime::AnyClass) -> bool {
    use objc2::runtime::{AnyObject, Imp, Sel};
    extern "C" fn zero(_: *mut AnyObject, _: Sel, _: objc2_foundation::NSRect) -> f64 {
        0.0
    }
    let imp: Imp = std::mem::transmute(zero as extern "C" fn(*mut AnyObject, Sel, objc2_foundation::NSRect) -> f64);
    objc2::ffi::class_addMethod(cls, objc2::sel!(animationResizeTime:), imp, c"d@:{CGRect={CGPoint=dd}{CGSize=dd}}".as_ptr()).as_bool()
}

#[cfg(all(test, target_os = "macos"))]
mod zoom_tests {
    use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    #[test]
    fn 최대화_애니메이션_시간을_0으로_덧붙인다() {
        // 11-18 사용자 "최대화 할 때 한번 버벅거려": 맥 zoom 은 setFrame:display:animate: 로 0.35초 애니메이션을 메인 스레드에서 돌리고,
        // 그동안 웹뷰는 새 그림을 못 받아 옛 크기(1440×868)로 왼쪽 위에 남고 나머지가 흰 칸(시험판 실측 rAF 틈 358ms)
        let cls = ClassBuilder::new(c"ChammoZoomTestWindow", objc2::class!(NSWindow)).expect("class").register() as *const AnyClass as *mut AnyClass;
        let sel = objc2::sel!(animationResizeTime:);
        let mine = |c: *mut AnyClass| unsafe {
            let m = objc2::ffi::class_getInstanceMethod(c, sel);
            let base = objc2::ffi::class_getInstanceMethod(objc2::class!(NSWindow) as *const AnyClass, sel);
            (!m.is_null() && m != base).then(|| objc2::ffi::method_getImplementation(m))
        };
        assert!(mine(cls).is_none(), "덧붙이기 전엔 NSWindow 것");
        assert!(unsafe { super::no_resize_animation(cls) });
        let imp = mine(cls).expect("덧붙인 뒤엔 이 클래스 것").expect("imp");
        let f: extern "C" fn(*mut AnyObject, Sel, NSRect) -> f64 = unsafe { std::mem::transmute(imp) };
        let r = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1920.0, 1050.0));
        assert_eq!(f(std::ptr::null_mut(), sel, r), 0.0);
        assert!(!unsafe { super::no_resize_animation(cls) }, "두 번째는 이미 있어 안 붙는다");
    }

    #[test]
    fn 앱이_켤_때_창_클래스에_건다() {
        let main = include_str!("main.rs");
        assert!(main.contains("win_frame::instant_zoom(app.handle())"), "setup 에서 부른다");
    }
}

#[cfg(test)]
mod tests {
    use super::{fit, Frame};

    #[test]
    fn 윈도우에선_창_기억을_끈다() {
        // 0.4.16 윈도우 실기: 다시 켤 때마다 1280×800 → 1280×780 으로 줄고 자리도 못 지켰다 — 고칠 때까진 윈도우에서 안 읽고 안 적는다
        assert_eq!(super::ON, !cfg!(target_os = "windows"));
        let src = include_str!("win_frame.rs");
        assert!(src.contains("pub fn prepare(ctx: &mut tauri::Context<tauri::Wry>) {\n    if !ON {"), "prepare 가 ON 을 먼저 본다");
        assert!(src.contains("if !ON || w.label() != \"main\""), "changed 가 ON 을 먼저 본다");
    }
    const LG: (f64, f64, f64, f64) = (0.0, 0.0, 1920.0, 1080.0);
    const MAC: (f64, f64, f64, f64) = (-1470.0, 124.0, 1470.0, 956.0);

    #[test]
    fn 꽉_채운_크기는_그대로_그_자리에() {
        // 11-18 사용자 화면 — LG 모니터에 꽉 채운 창 1920×1050(맥 Tauri inner_size 는 제목줄을 포함한 틀 — 설정 파일 width/height 도 같은 값)
        let f = Frame { x: 0.0, y: 30.0, w: 1920.0, h: 1050.0 };
        assert_eq!(fit(f, &[LG, MAC]), Some(((1920.0, 1050.0), Some((0.0, 30.0)))));
    }

    #[test]
    fn 빠진_화면에_있던_창은_가운데로_남은_화면에_맞게() {
        // 큰 모니터에서 꽉 채운 뒤 노트북만 남음 — 자리 버리고 크기는 노트북 화면까지
        let f = Frame { x: 0.0, y: 30.0, w: 1920.0, h: 1050.0 };
        assert_eq!(fit(f, &[MAC]), Some(((1470.0, 956.0), None)));
    }

    #[test]
    fn 제목줄이_조금만_걸치면_자리를_버린다() {
        // 제목줄이 화면 오른쪽 끝 50pt 만 걸침 — 잡을 수 없다
        let f = Frame { x: 1870.0, y: 100.0, w: 1200.0, h: 800.0 };
        assert_eq!(fit(f, &[LG]).map(|v| v.1), Some(None));
        // 제목줄이 화면 위로 나감(아래 몸통만 화면) — 잡을 수 없다
        let f = Frame { x: 100.0, y: -200.0, w: 1200.0, h: 800.0 };
        assert_eq!(fit(f, &[LG]).map(|v| v.1), Some(None));
    }

    #[test]
    fn 두_화면에_걸치면_제목줄이_더_많이_걸친_화면으로_크기를_맞춘다() {
        let f = Frame { x: -400.0, y: 200.0, w: 1800.0, h: 1000.0 };
        // 노트북 쪽 400, LG 쪽 1400 → LG 기준, 높이 1000 ≤ 1080 그대로
        assert_eq!(fit(f, &[MAC, LG]), Some(((1800.0, 1000.0), Some((-400.0, 200.0)))));
    }

    #[test]
    fn 이상한_값은_안_쓴다() {
        let ok = Frame { x: 0.0, y: 30.0, w: 1440.0, h: 900.0 };
        assert!(fit(Frame { w: 640.0, h: 440.0, ..ok }, &[LG]).is_none(), "첫 설치 창 크기");
        assert!(fit(Frame { w: f64::NAN, ..ok }, &[LG]).is_none());
        assert!(fit(Frame { x: f64::INFINITY, ..ok }, &[LG]).is_none());
        assert!(fit(Frame { w: 99999.0, ..ok }, &[LG]).is_none());
    }

    #[test]
    fn 화면을_못_읽으면_크기만() {
        let f = Frame { x: 0.0, y: 30.0, w: 1920.0, h: 1050.0 };
        assert_eq!(fit(f, &[]), Some(((1920.0, 1050.0), None)));
    }

    #[test]
    fn 최소보다_작은_화면이면_화면에_맞춘다() {
        // 화면이 1024 보다 좁으면(거의 없지만) 최소 크기 대신 화면 폭
        let small = (0.0, 0.0, 1000.0, 600.0);
        let f = Frame { x: 0.0, y: 30.0, w: 1440.0, h: 900.0 };
        assert_eq!(fit(f, &[small]).map(|v| v.0), Some((1000.0, 600.0)));
    }
}

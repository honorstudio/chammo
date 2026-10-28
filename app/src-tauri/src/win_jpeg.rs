//! 윈도우 JPEG 풀기 — GDI+(윈도우마다 있는 것, 새 크레이트 없이). 세션 브라우저 칸(browser_pane_win)이 CDP screencast 그림을 풀 때.
//! 아무 실에서나 불러도 된다(GDI+ 는 처음 한 번 켠다)
use std::ffi::c_void;
use std::sync::OnceLock;

use windows_sys::Win32::Graphics::GdiPlus::*;
use windows_sys::Win32::UI::Shell::SHCreateMemStream;

/// 풀린 그림 — 위에서 아래로 BGRA(StretchDIBits 32비트 그대로)
pub struct Img {
    pub w: i32,
    pub h: i32,
    pub px: Vec<u8>,
}

const PIXEL_32BPP_RGB: i32 = 0x0002_2009;

fn gdiplus() -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| unsafe {
        let mut token = 0usize;
        let input = GdiplusStartupInput { GdiplusVersion: 1, ..Default::default() };
        GdiplusStartup(&mut token, &input, std::ptr::null_mut()) == 0
    })
}

/// IUnknown::Release(vtable 세 번째)
unsafe fn release(p: *mut c_void) {
    let vt = *(p as *const *const usize);
    let f: unsafe extern "system" fn(*mut c_void) -> u32 = std::mem::transmute(*vt.add(2));
    f(p);
}

/// JPEG → BGRA(위에서 아래로). 못 풀면 None
pub fn decode(jpeg: &[u8]) -> Option<Img> {
    if jpeg.is_empty() || !gdiplus() {
        return None;
    }
    unsafe {
        let stream = SHCreateMemStream(jpeg.as_ptr(), jpeg.len() as u32);
        if stream.is_null() {
            return None;
        }
        let mut bmp: *mut GpBitmap = std::ptr::null_mut();
        let st = GdipCreateBitmapFromStream(stream, &mut bmp);
        let out = (st == 0 && !bmp.is_null()).then(|| {
            let (mut w, mut h) = (0u32, 0u32);
            GdipGetImageWidth(bmp as *mut GpImage, &mut w);
            GdipGetImageHeight(bmp as *mut GpImage, &mut h);
            let rect = Rect { X: 0, Y: 0, Width: w as i32, Height: h as i32 };
            let mut data = BitmapData::default();
            let mut img = None;
            if w > 0 && h > 0 && GdipBitmapLockBits(bmp, &rect, ImageLockModeRead as u32, PIXEL_32BPP_RGB, &mut data) == 0 {
                let row = w as usize * 4;
                let mut px = vec![0u8; row * h as usize];
                for y in 0..h as usize {
                    let src = (data.Scan0 as *const u8).offset(y as isize * data.Stride as isize);
                    std::ptr::copy_nonoverlapping(src, px.as_mut_ptr().add(y * row), row);
                }
                GdipBitmapUnlockBits(bmp, &mut data);
                img = Some(Img { w: w as i32, h: h as i32, px });
            }
            GdipDisposeImage(bmp as *mut GpImage);
            img
        });
        release(stream);
        out.flatten()
    }
}

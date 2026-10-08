//! 참모 프사 — <데이터 폴더>/avatars/<기본 이름>.json + 올린 그림(<기본 이름>.png|jpg|gif|webp).
//! 키는 별명 앞 기본 이름(참모-2)이라 "참모-2 · 별명"으로 바뀌어도 유지된다(키 만들기는 프론트 domain/avatar.ts).
//! 그림은 리더의 hodoc:// 로 보여 준다(새 주소 체계 없이). 여기선 읽기·저장·지우기 셋만, 검사는 전부 여기서 다시 한다
use crate::i18n::tr;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 올린 그림 상한 — GIF 도 이 안에서(시안 D-6)
pub const MAX_IMAGE: usize = 5 * 1024 * 1024;
const EXTS: [&str; 4] = ["png", "jpg", "gif", "webp"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Crop {
    pub zoom: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Avatar {
    /// 기본형 — 도형·눈 이름은 프론트 목록에서 다시 거른다. color 가 없으면 참모 순서 색
    Preset { shape: String, eyes: String, #[serde(default)] color: Option<String>, #[serde(default, skip_serializing_if = "Option::is_none")] voice: Option<String> },
    /// 올린 그림 — file 은 여기서 정한다(<키>.<확장자>), 들어온 값은 믿지 않는다
    Image { #[serde(default)] file: String, crop: Crop, #[serde(default, skip_serializing_if = "Option::is_none")] voice: Option<String> },
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    pub key: String,
    pub avatar: Avatar,
    /// 그림이 바뀌면 달라지는 값(수정 시각 ms) — 주소 뒤에 붙여 캐시를 깬다
    pub v: u64,
}

fn bad(ko: &str, en: &str) -> String {
    tr(ko, en).to_string()
}

/// 파일 이름이 될 키 — 글자·숫자·'-'·'_'·띄어쓰기만, 64자까지. '.'·'/'·'\\'·':' 는 아예 못 들어와 경로를 못 벗어난다
pub fn safe_key(k: &str) -> Result<String, String> {
    let k = k.trim();
    // 윈도우 예약 이름(CON·NUL·COM1…)은 파일이 아니라 장치로 열린다
    let upper = k.to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&upper.as_str())
        || ((upper.starts_with("COM") || upper.starts_with("LPT")) && upper.len() == 4 && upper.as_bytes()[3].is_ascii_digit());
    let ok = !reserved && !k.is_empty() && k.chars().count() <= 64 && k.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ' ');
    if ok { Ok(k.to_string()) } else { Err(format!("{}: {k:?}", bad("프로필 이름이 이상해", "Invalid avatar name"))) }
}

/// 첫 바이트로 그림 종류를 가린다 — 확장자·MIME 는 믿지 않는다. SVG 는 받지 않는다(스크립트가 들어갈 수 있다)
pub fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some("gif")
    } else if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn valid_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 16 && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())
}

/// 값 검사 — 고르기 창 밖에서 json 을 손으로 고쳐도 이상한 값이 화면에 안 가게
pub fn check(a: &Avatar) -> Result<(), String> {
    // 목소리(참모 프로필) — Supertonic 10개 안에서만
    let voice = match a { Avatar::Preset { voice, .. } | Avatar::Image { voice, .. } => voice };
    if voice.as_deref().is_some_and(|v| !crate::tts::VOICES.contains(&v)) {
        return Err(bad("목소리 값이 이상해", "Invalid voice"));
    }
    match a {
        Avatar::Preset { shape, eyes, color, .. } => {
            if !valid_name(shape) || !valid_name(eyes) || color.as_deref().is_some_and(|c| !valid_color(c)) {
                return Err(bad("기본형 값이 이상해", "Invalid preset values"));
            }
        }
        Avatar::Image { crop, .. } => {
            let Crop { zoom, x, y } = crop;
            if !(zoom.is_finite() && (1.0..=4.0).contains(zoom) && x.is_finite() && (-1.0..=1.0).contains(x) && y.is_finite() && (-1.0..=1.0).contains(y)) {
                return Err(bad("자르기 값이 이상해", "Invalid crop values"));
            }
        }
    }
    Ok(())
}

fn image_paths(dir: &Path, key: &str) -> Vec<PathBuf> {
    EXTS.iter().map(|e| dir.join(format!("{key}.{e}"))).collect()
}

/// 쓰는 도중에 읽혀도 안 깨지게 임시 파일에 쓰고 옮긴다
fn write_atomic(path: &Path, body: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!("{}.tmp", path.extension().and_then(|e| e.to_str()).unwrap_or("")));
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

fn mtime_ms(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 하나 읽기 — 검사에 걸리거나 그림 파일이 없으면 None(프론트는 기본형으로)
fn read_one(dir: &Path, key: &str) -> Option<Entry> {
    let json = dir.join(format!("{key}.json"));
    let mut avatar: Avatar = serde_json::from_str(&std::fs::read_to_string(&json).ok()?).ok()?;
    check(&avatar).ok()?;
    let mut v = mtime_ms(&json);
    if let Avatar::Image { file, .. } = &mut avatar {
        // json 의 file 은 믿지 않는다 — <키>.<허용 확장자> 중 실제로 있는 것
        let found = EXTS.iter().map(|e| format!("{key}.{e}")).find(|f| dir.join(f).is_file())?;
        v = mtime_ms(&dir.join(&found));
        *file = found;
    }
    Some(Entry { key: key.to_string(), avatar, v })
}

pub fn read_all_in(dir: &Path) -> Vec<Entry> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<Entry> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let key = name.strip_suffix(".json")?;
            let key = safe_key(key).ok().filter(|k| k == key)?;
            read_one(dir, &key)
        })
        .collect();
    out.sort_by(|a, b| a.key.cmp(&b.key));
    out
}

/// 저장. image 가 있으면 새 그림(검사 후 <키>.<확장자>, 다른 확장자 옛 그림은 지움),
/// 그림 프사인데 image 가 없으면 자르기만 바꾼 것 — 있던 그림을 그대로 쓴다. 기본형이면 그림을 지운다
pub fn save_in(dir: &Path, key: &str, mut avatar: Avatar, image: Option<&[u8]>) -> Result<Entry, String> {
    let key = safe_key(key)?;
    check(&avatar)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    match (&mut avatar, image) {
        (Avatar::Preset { .. }, Some(_)) => return Err(bad("기본형엔 그림을 붙이지 않아", "A preset takes no image")),
        (Avatar::Preset { .. }, None) => {
            for p in image_paths(dir, &key) {
                let _ = std::fs::remove_file(p);
            }
        }
        (Avatar::Image { file, .. }, Some(bytes)) => {
            if bytes.is_empty() || bytes.len() > MAX_IMAGE {
                return Err(bad("그림은 5MB 까지야", "Images must be 5 MB or smaller"));
            }
            let ext = sniff(bytes).ok_or_else(|| bad("PNG·JPG·GIF·WebP 그림만 돼", "Only PNG, JPG, GIF or WebP images"))?;
            let name = format!("{key}.{ext}");
            write_atomic(&dir.join(&name), bytes)?;
            for p in image_paths(dir, &key) {
                if p.file_name().and_then(|n| n.to_str()) != Some(name.as_str()) {
                    let _ = std::fs::remove_file(p);
                }
            }
            *file = name;
        }
        (Avatar::Image { file, .. }, None) => {
            *file = EXTS.iter().map(|e| format!("{key}.{e}")).find(|f| dir.join(f).is_file()).ok_or_else(|| bad("올린 그림이 없어", "No uploaded image"))?;
        }
    }
    let json = serde_json::to_vec_pretty(&avatar).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{key}.json")), &json)?;
    read_one(dir, &key).ok_or_else(|| bad("저장한 프로필을 다시 못 읽었어", "Could not read the saved avatar"))
}

pub fn delete_in(dir: &Path, key: &str) -> Result<(), String> {
    let key = safe_key(key)?;
    let _ = std::fs::remove_file(dir.join(format!("{key}.json")));
    for p in image_paths(dir, &key) {
        let _ = std::fs::remove_file(p);
    }
    Ok(())
}

fn avatars_dir() -> PathBuf {
    crate::config::data_file("avatars")
}

#[tauri::command]
pub fn avatars_read() -> Vec<Entry> {
    read_all_in(&avatars_dir())
}

#[tauri::command]
pub fn avatar_save(key: String, avatar: Avatar, image: Option<Vec<u8>>) -> Result<Entry, String> {
    save_in(&avatars_dir(), &key, avatar, image.as_deref())
}

#[tauri::command]
pub fn avatar_delete(key: String) -> Result<(), String> {
    delete_in(&avatars_dir(), &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chammo-avatar-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
    const GIF: &[u8] = b"GIF89a\x01\x00\x01\x00";
    fn img(zoom: f64) -> Avatar {
        Avatar::Image { file: String::new(), crop: Crop { zoom, x: 0.0, y: 0.0 }, voice: None }
    }
    fn preset() -> Avatar {
        Avatar::Preset { shape: "mochi".into(), eyes: "pill".into(), color: Some("#2f74e0".into()), voice: None }
    }

    #[test]
    fn 키는_경로를_못_벗어난다() {
        assert_eq!(safe_key(" 참모-2 ").unwrap(), "참모-2");
        assert_eq!(safe_key("Chammo 3").unwrap(), "Chammo 3");
        for k in ["CON", "nul", "com1", "LPT9", "", "   ", "../x", "a/b", "a\\b", "..", ".hidden", "a:b", "x\0y", "참모.json", &"가".repeat(65)] {
            assert!(safe_key(k).is_err(), "{k:?} 는 거절돼야");
        }
    }

    #[test]
    fn 그림_종류는_첫_바이트로_가린다() {
        assert_eq!(sniff(PNG), Some("png"));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(sniff(GIF), Some("gif"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff(b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), None);
        assert_eq!(sniff(b"<html>"), None);
        assert_eq!(sniff(b"RIFF\0\0\0\0WAVE"), None);
        assert_eq!(sniff(&[]), None);
    }

    #[test]
    fn 기본형_저장_읽기_지우기() {
        let d = tmp("preset");
        let e = save_in(&d, "참모-2", preset(), None).unwrap();
        assert_eq!(e.key, "참모-2");
        assert_eq!(read_all_in(&d), vec![Entry { key: "참모-2".into(), avatar: preset(), v: e.v }]);
        delete_in(&d, "참모-2").unwrap();
        assert!(read_all_in(&d).is_empty());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn 그림_저장은_검사하고_이름은_여기서_정한다() {
        let d = tmp("image");
        // 들어온 file 값(경로 조작)은 무시된다
        let sneaky = Avatar::Image { file: "../../evil.sh".into(), crop: Crop { zoom: 1.5, x: 0.2, y: -0.1 }, voice: None };
        let e = save_in(&d, "참모", sneaky, Some(PNG)).unwrap();
        assert!(matches!(&e.avatar, Avatar::Image { file, .. } if file == "참모.png"));
        assert!(d.join("참모.png").is_file());
        assert!(!d.parent().unwrap().join("evil.sh").exists());
        // 다른 종류로 바꾸면 옛 그림은 지운다
        save_in(&d, "참모", img(1.0), Some(GIF)).unwrap();
        assert!(d.join("참모.gif").is_file() && !d.join("참모.png").exists());
        // 그림 없이 자르기만 바꾸면 있던 그림 그대로
        let e = save_in(&d, "참모", img(2.0), None).unwrap();
        assert!(matches!(&e.avatar, Avatar::Image { file, crop, .. } if file == "참모.gif" && crop.zoom == 2.0));
        // 기본형으로 돌리면 그림도 지운다
        save_in(&d, "참모", preset(), None).unwrap();
        assert!(!d.join("참모.gif").exists());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn 거절되는_그림() {
        let d = tmp("reject");
        assert!(save_in(&d, "참모", img(1.0), Some(b"<svg/>")).is_err(), "SVG·HTML 은 안 받는다");
        assert!(save_in(&d, "참모", img(1.0), Some(&[])).is_err());
        let mut big = PNG.to_vec();
        big.resize(MAX_IMAGE + 1, 0);
        assert!(save_in(&d, "참모", img(1.0), Some(&big)).is_err(), "5MB 넘으면 거절");
        let mut ok = PNG.to_vec();
        ok.resize(MAX_IMAGE, 0);
        assert!(save_in(&d, "참모", img(1.0), Some(&ok)).is_ok(), "딱 5MB 는 된다");
        assert!(save_in(&d, "참모", preset(), Some(PNG)).is_err(), "기본형엔 그림 안 붙인다");
        assert!(save_in(&d, "새참모", img(1.0), None).is_err(), "그림 없이 그림 프사는 안 된다");
        assert!(save_in(&d, "../참모", preset(), None).is_err());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn 이상한_값은_저장도_읽기도_안_된다() {
        let d = tmp("values");
        for a in [
            Avatar::Preset { shape: "../x".into(), eyes: "pill".into(), color: None, voice: None },
            Avatar::Preset { shape: "mochi".into(), eyes: "pill".into(), color: Some("red;background:url(x)".into()), voice: None },
            Avatar::Preset { shape: "mochi".into(), eyes: "pill".into(), color: None, voice: Some("M1; rm -rf ~".into()) },
            Avatar::Image { file: String::new(), crop: Crop { zoom: f64::NAN, x: 0.0, y: 0.0 }, voice: None },
            Avatar::Image { file: String::new(), crop: Crop { zoom: 9.0, x: 0.0, y: 0.0 }, voice: None },
            Avatar::Image { file: String::new(), crop: Crop { zoom: 1.0, x: 3.0, y: 0.0 }, voice: Some("X9".into()) },
        ] {
            assert!(save_in(&d, "참모", a, Some(PNG)).is_err());
        }
        // 손으로 고친 json — 그림 파일 이름을 바깥으로 돌려도 <키>.<확장자> 만 본다
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("참모-3.json"), r#"{"kind":"image","file":"../../../etc/passwd","crop":{"zoom":1,"x":0,"y":0}}"#).unwrap();
        assert!(read_all_in(&d).is_empty(), "그림 파일이 없으면 건너뛴다");
        std::fs::write(d.join("참모-3.png"), PNG).unwrap();
        let got = read_all_in(&d);
        assert!(matches!(&got[0].avatar, Avatar::Image { file, .. } if file == "참모-3.png"));
        std::fs::write(d.join("참모-4.json"), r#"{"kind":"preset","shape":"mochi","eyes":"pill","color":"javascript:1"}"#).unwrap();
        std::fs::write(d.join("깨짐.json"), "{not json").unwrap();
        assert_eq!(read_all_in(&d).len(), 1, "이상한 값·깨진 파일은 건너뛴다");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn 목소리도_같이_저장된다() {
        let d = tmp("voice");
        let a = Avatar::Preset { shape: "star".into(), eyes: "dark".into(), color: None, voice: Some("F2".into()) };
        assert_eq!(save_in(&d, "참모-3", a.clone(), None).unwrap().avatar, a);
        assert_eq!(read_all_in(&d)[0].avatar, a);
        // 목소리 없이 저장한 옛 파일도 그대로 읽힌다
        std::fs::write(d.join("참모-4.json"), r#"{"kind":"preset","shape":"mochi","eyes":"pill","color":null}"#).unwrap();
        assert!(matches!(&read_all_in(&d)[1].avatar, Avatar::Preset { voice: None, .. }));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn 지우기는_없어도_괜찮고_키는_검사한다() {
        let d = tmp("delete");
        assert!(delete_in(&d, "없는참모").is_ok());
        assert!(delete_in(&d, "../../x").is_err());
    }
}

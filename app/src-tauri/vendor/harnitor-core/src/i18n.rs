//! 어느 말로 낼 것인가.
//!
//! 화면은 이미 한/영을 바꿀 수 있는데 **코어가 만든 문장은 한국어로 굳어 있었다**.
//! 진단 제목·설명·계획 요약이 그렇고, 그건 화면에서 EN 을 눌러도 안 바뀐다 —
//! 반쯤 번역된 화면은 아예 한국어인 것보다 나쁘다.
//!
//! 그래서 **문장을 만드는 자리에서 언어를 받는다.** 화면 쪽 `t()` 사전처럼
//! 한국어 원문을 키로 삼는 방법도 있었지만, 진단 문구는 숫자가 박힌 문장이라
//! (`"호출 기록이 없는 스킬 65개 · 매 세션 약 8820토큰"`) 사전에 넣을 키가 만들어지지 않는다.

use serde::{Deserialize, Serialize};

/// 출력 언어.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    /// 기본값. 오픈소스로 나가는 도구라 모르면 영어다.
    #[default]
    En,
    Ko,
}

impl Lang {
    /// 문자열에서 고른다. `ko`, `ko_KR`, `ko_KR.UTF-8`, `KO`, `Korean` 을 모두 받는다 —
    /// 로케일 표기가 제각각이라 정확히 일치를 요구하면 대부분 놓친다.
    ///
    /// 다만 **앞글자만 보고 판단하지는 않는다.** `starts_with("ko")` 로 하면
    /// `kok_IN`(콘칸어)까지 한국어가 된다. 지역·인코딩을 떼고 **언어 부분만** 비교한다.
    pub fn parse(s: &str) -> Self {
        let head = s
            .trim()
            .to_ascii_lowercase()
            .split(['_', '-', '.', '@'])
            .next()
            .unwrap_or("")
            .to_string();
        if head == "ko" || head == "korean" {
            Lang::Ko
        } else {
            Lang::En
        }
    }

    /// 환경에서 고른다.
    ///
    /// `HARNITOR_LANG` 이 가장 세다 — 로케일이 한국어인 사람도 영어 출력을 붙여 넣고
    /// 싶을 때가 있고(이슈 리포트), 그때 로케일을 통째로 바꾸게 만들면 안 된다.
    /// 그 다음은 POSIX 순서인 `LC_ALL` → `LC_MESSAGES` → `LANG` 이다.
    pub fn from_env() -> Self {
        for key in ["HARNITOR_LANG", "LC_ALL", "LC_MESSAGES", "LANG"] {
            if let Some(v) = std::env::var_os(key) {
                let v = v.to_string_lossy();
                if !v.trim().is_empty() {
                    return Lang::parse(&v);
                }
            }
        }
        Lang::En
    }

    pub fn is_ko(self) -> bool {
        self == Lang::Ko
    }
}

/// 한국어인지에 따라 둘 중 하나를 고른다.
///
/// `match` 를 문장마다 쓰면 진단 아홉 건이 스무 겹의 `match` 로 불어난다.
/// 읽을 때 중요한 것은 분기가 아니라 **두 문장이 나란히 있다**는 사실이다.
pub fn pick(lang: Lang, ko: &str, en: &str) -> String {
    if lang.is_ko() { ko } else { en }.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 로케일_표기가_달라도_한국어를_알아본다() {
        for s in [
            "ko",
            "ko_KR",
            "ko_KR.UTF-8",
            "KO",
            "  ko_KR  ",
            "Korean",
            "ko-KR",
        ] {
            assert_eq!(Lang::parse(s), Lang::Ko, "{s}");
        }
    }

    #[test]
    fn 모르는_말은_영어다() {
        // kok_IN 은 콘칸어다. 앞글자만 보면 한국어로 잘못 잡힌다.
        for s in ["", "en_US.UTF-8", "ja_JP", "C", "kok_IN", "kor"] {
            assert_eq!(Lang::parse(s), Lang::En, "{s}");
        }
    }

    #[test]
    fn 기본값은_영어다() {
        assert_eq!(Lang::default(), Lang::En);
    }

    #[test]
    fn pick_은_언어에_맞는_쪽을_준다() {
        assert_eq!(pick(Lang::Ko, "가", "a"), "가");
        assert_eq!(pick(Lang::En, "가", "a"), "a");
    }
}

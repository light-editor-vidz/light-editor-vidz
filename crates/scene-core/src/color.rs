//! Analyse des couleurs CSS saisies dans l'éditeur (champ couleur, import legacy).
//!
//! Formats supportés : `rgb()/rgba()` (virgules ou espaces, alpha en nombre ou en %),
//! `hsl()/hsla()`, `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `transparent` et les noms de couleurs
//! CSS standard. Le rendu natif doit comprendre tout ce que la preview (le navigateur) accepte.

use tiny_skia::Color;

/// Noms de couleurs CSS (valeurs 0xRRGGBB), triés par nom pour la recherche dichotomique.
const NAMED: &[(&str, u32)] = &[
    ("aliceblue", 0xf0f8ff),
    ("antiquewhite", 0xfaebd7),
    ("aqua", 0x00ffff),
    ("aquamarine", 0x7fffd4),
    ("azure", 0xf0ffff),
    ("beige", 0xf5f5dc),
    ("bisque", 0xffe4c4),
    ("black", 0x000000),
    ("blanchedalmond", 0xffebcd),
    ("blue", 0x0000ff),
    ("blueviolet", 0x8a2be2),
    ("brown", 0xa52a2a),
    ("burlywood", 0xdeb887),
    ("cadetblue", 0x5f9ea0),
    ("chartreuse", 0x7fff00),
    ("chocolate", 0xd2691e),
    ("coral", 0xff7f50),
    ("cornflowerblue", 0x6495ed),
    ("cornsilk", 0xfff8dc),
    ("crimson", 0xdc143c),
    ("cyan", 0x00ffff),
    ("darkblue", 0x00008b),
    ("darkcyan", 0x008b8b),
    ("darkgoldenrod", 0xb8860b),
    ("darkgray", 0xa9a9a9),
    ("darkgreen", 0x006400),
    ("darkgrey", 0xa9a9a9),
    ("darkkhaki", 0xbdb76b),
    ("darkmagenta", 0x8b008b),
    ("darkolivegreen", 0x556b2f),
    ("darkorange", 0xff8c00),
    ("darkorchid", 0x9932cc),
    ("darkred", 0x8b0000),
    ("darksalmon", 0xe9967a),
    ("darkseagreen", 0x8fbc8f),
    ("darkslateblue", 0x483d8b),
    ("darkslategray", 0x2f4f4f),
    ("darkslategrey", 0x2f4f4f),
    ("darkturquoise", 0x00ced1),
    ("darkviolet", 0x9400d3),
    ("deeppink", 0xff1493),
    ("deepskyblue", 0x00bfff),
    ("dimgray", 0x696969),
    ("dimgrey", 0x696969),
    ("dodgerblue", 0x1e90ff),
    ("firebrick", 0xb22222),
    ("floralwhite", 0xfffaf0),
    ("forestgreen", 0x228b22),
    ("fuchsia", 0xff00ff),
    ("gainsboro", 0xdcdcdc),
    ("ghostwhite", 0xf8f8ff),
    ("gold", 0xffd700),
    ("goldenrod", 0xdaa520),
    ("gray", 0x808080),
    ("green", 0x008000),
    ("greenyellow", 0xadff2f),
    ("grey", 0x808080),
    ("honeydew", 0xf0fff0),
    ("hotpink", 0xff69b4),
    ("indianred", 0xcd5c5c),
    ("indigo", 0x4b0082),
    ("ivory", 0xfffff0),
    ("khaki", 0xf0e68c),
    ("lavender", 0xe6e6fa),
    ("lavenderblush", 0xfff0f5),
    ("lawngreen", 0x7cfc00),
    ("lemonchiffon", 0xfffacd),
    ("lightblue", 0xadd8e6),
    ("lightcoral", 0xf08080),
    ("lightcyan", 0xe0ffff),
    ("lightgoldenrodyellow", 0xfafad2),
    ("lightgray", 0xd3d3d3),
    ("lightgreen", 0x90ee90),
    ("lightgrey", 0xd3d3d3),
    ("lightpink", 0xffb6c1),
    ("lightsalmon", 0xffa07a),
    ("lightseagreen", 0x20b2aa),
    ("lightskyblue", 0x87cefa),
    ("lightslategray", 0x778899),
    ("lightslategrey", 0x778899),
    ("lightsteelblue", 0xb0c4de),
    ("lightyellow", 0xffffe0),
    ("lime", 0x00ff00),
    ("limegreen", 0x32cd32),
    ("linen", 0xfaf0e6),
    ("magenta", 0xff00ff),
    ("maroon", 0x800000),
    ("mediumaquamarine", 0x66cdaa),
    ("mediumblue", 0x0000cd),
    ("mediumorchid", 0xba55d3),
    ("mediumpurple", 0x9370db),
    ("mediumseagreen", 0x3cb371),
    ("mediumslateblue", 0x7b68ee),
    ("mediumspringgreen", 0x00fa9a),
    ("mediumturquoise", 0x48d1cc),
    ("mediumvioletred", 0xc71585),
    ("midnightblue", 0x191970),
    ("mintcream", 0xf5fffa),
    ("mistyrose", 0xffe4e1),
    ("moccasin", 0xffe4b5),
    ("navajowhite", 0xffdead),
    ("navy", 0x000080),
    ("oldlace", 0xfdf5e6),
    ("olive", 0x808000),
    ("olivedrab", 0x6b8e23),
    ("orange", 0xffa500),
    ("orangered", 0xff4500),
    ("orchid", 0xda70d6),
    ("palegoldenrod", 0xeee8aa),
    ("palegreen", 0x98fb98),
    ("paleturquoise", 0xafeeee),
    ("palevioletred", 0xdb7093),
    ("papayawhip", 0xffefd5),
    ("peachpuff", 0xffdab9),
    ("peru", 0xcd853f),
    ("pink", 0xffc0cb),
    ("plum", 0xdda0dd),
    ("powderblue", 0xb0e0e6),
    ("purple", 0x800080),
    ("rebeccapurple", 0x663399),
    ("red", 0xff0000),
    ("rosybrown", 0xbc8f8f),
    ("royalblue", 0x4169e1),
    ("saddlebrown", 0x8b4513),
    ("salmon", 0xfa8072),
    ("sandybrown", 0xf4a460),
    ("seagreen", 0x2e8b57),
    ("seashell", 0xfff5ee),
    ("sienna", 0xa0522d),
    ("silver", 0xc0c0c0),
    ("skyblue", 0x87ceeb),
    ("slateblue", 0x6a5acd),
    ("slategray", 0x708090),
    ("slategrey", 0x708090),
    ("snow", 0xfffafa),
    ("springgreen", 0x00ff7f),
    ("steelblue", 0x4682b4),
    ("tan", 0xd2b48c),
    ("teal", 0x008080),
    ("thistle", 0xd8bfd8),
    ("tomato", 0xff6347),
    ("turquoise", 0x40e0d0),
    ("violet", 0xee82ee),
    ("wheat", 0xf5deb3),
    ("white", 0xffffff),
    ("whitesmoke", 0xf5f5f5),
    ("yellow", 0xffff00),
    ("yellowgreen", 0x9acd32),
];

/// Couleur utilisée quand la saisie n'est pas reconnue (même repli historique : blanc opaque).
pub fn parse_css_color(s: &str) -> Color {
    try_parse_css_color(s).unwrap_or(Color::WHITE)
}

pub fn try_parse_css_color(s: &str) -> Option<Color> {
    let s = s.trim().to_ascii_lowercase();
    if let Some(hex) = s.strip_prefix('#') {
        return parse_hex(hex);
    }
    if s == "transparent" {
        return Color::from_rgba(0.0, 0.0, 0.0, 0.0);
    }
    if let Some(args) = function_args(&s, &["rgba", "rgb"]) {
        return parse_rgb(&args);
    }
    if let Some(args) = function_args(&s, &["hsla", "hsl"]) {
        return parse_hsl(&args);
    }
    NAMED
        .binary_search_by_key(&s.as_str(), |(name, _)| name)
        .ok()
        .map(|i| {
            let v = NAMED[i].1;
            Color::from_rgba8((v >> 16) as u8, (v >> 8) as u8, v as u8, 255)
        })
}

fn parse_hex(hex: &str) -> Option<Color> {
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let digits: Vec<u8> = hex
        .chars()
        .map(|c| c.to_digit(16).unwrap_or(0) as u8)
        .collect();
    let channel = |i: usize| -> u8 { digits[i] * 16 + digits[i + 1] };
    let short = |i: usize| -> u8 { digits[i] * 17 };
    match digits.len() {
        3 => Some(Color::from_rgba8(short(0), short(1), short(2), 255)),
        4 => Some(Color::from_rgba8(short(0), short(1), short(2), short(3))),
        6 => Some(Color::from_rgba8(channel(0), channel(2), channel(4), 255)),
        8 => Some(Color::from_rgba8(
            channel(0),
            channel(2),
            channel(4),
            channel(6),
        )),
        _ => None,
    }
}

/// Arguments d'une notation fonctionnelle (`rgb(…)`, `hsla(…)`), séparés par virgules, espaces
/// ou `/` (alpha).
fn function_args(s: &str, names: &[&str]) -> Option<Vec<String>> {
    let inner = names.iter().find_map(|name| {
        s.strip_prefix(name)
            .map(str::trim_start)
            .and_then(|rest| rest.strip_prefix('('))
            .and_then(|rest| rest.strip_suffix(')'))
    })?;
    Some(
        inner
            .split(|c: char| c == ',' || c == '/' || c.is_whitespace())
            .filter(|p| !p.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

/// Nombre ou pourcentage → fraction (`pct_scale` = valeur correspondant à 100 %).
fn number_or_percent(part: &str, full_scale: f32) -> Option<f32> {
    match part.strip_suffix('%') {
        Some(p) => p.parse::<f32>().ok().map(|v| v / 100.0 * full_scale),
        None => part.parse::<f32>().ok(),
    }
}

fn alpha_part(parts: &[String]) -> Option<f32> {
    match parts.get(3) {
        Some(a) => number_or_percent(a, 1.0).map(|v| v.clamp(0.0, 1.0)),
        None => Some(1.0),
    }
}

fn parse_rgb(parts: &[String]) -> Option<Color> {
    if parts.len() != 3 && parts.len() != 4 {
        return None;
    }
    let channel = |i: usize| -> Option<f32> {
        number_or_percent(&parts[i], 255.0).map(|v| (v / 255.0).clamp(0.0, 1.0))
    };
    Color::from_rgba(channel(0)?, channel(1)?, channel(2)?, alpha_part(parts)?)
}

fn parse_hsl(parts: &[String]) -> Option<Color> {
    if parts.len() != 3 && parts.len() != 4 {
        return None;
    }
    let hue = parts[0].trim_end_matches("deg").parse::<f32>().ok()?;
    let sat = (number_or_percent(&parts[1], 1.0)?).clamp(0.0, 1.0);
    let light = (number_or_percent(&parts[2], 1.0)?).clamp(0.0, 1.0);
    let h = hue.rem_euclid(360.0) / 360.0;
    let q = if light < 0.5 {
        light * (1.0 + sat)
    } else {
        light + sat - light * sat
    };
    let p = 2.0 * light - q;
    let channel = |t: f32| -> f32 {
        let t = t.rem_euclid(1.0);
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    Color::from_rgba(
        channel(h + 1.0 / 3.0),
        channel(h),
        channel(h - 1.0 / 3.0),
        alpha_part(parts)?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba8(c: Color) -> (u8, u8, u8, u8) {
        let c = c.to_color_u8();
        (c.red(), c.green(), c.blue(), c.alpha())
    }

    #[test]
    fn named_colors_table_is_sorted_for_binary_search() {
        assert!(NAMED.windows(2).all(|w| w[0].0 < w[1].0));
    }

    #[test]
    fn parses_rgb_and_rgba_in_all_notations() {
        assert_eq!(
            rgba8(parse_css_color("rgba(255,0,0,0.5)")),
            (255, 0, 0, 128)
        );
        assert_eq!(rgba8(parse_css_color("rgb(0, 128, 0)")), (0, 128, 0, 255));
        assert_eq!(
            rgba8(parse_css_color("rgb(0 0 255 / 50%)")),
            (0, 0, 255, 128)
        );
        assert_eq!(
            rgba8(parse_css_color("rgb(100%, 0%, 0%)")),
            (255, 0, 0, 255)
        );
    }

    #[test]
    fn parses_hex_in_short_and_long_forms() {
        assert_eq!(rgba8(parse_css_color("#0000ff")), (0, 0, 255, 255));
        assert_eq!(rgba8(parse_css_color("#00ff0080")), (0, 255, 0, 128));
        assert_eq!(rgba8(parse_css_color("#f00")), (255, 0, 0, 255));
        assert_eq!(rgba8(parse_css_color("#f008")), (255, 0, 0, 136));
    }

    #[test]
    fn parses_hsl_and_hsla() {
        assert_eq!(
            rgba8(parse_css_color("hsl(0, 100%, 50%)")),
            (255, 0, 0, 255)
        );
        assert_eq!(
            rgba8(parse_css_color("hsla(120, 100%, 25%, 0.5)")),
            (0, 128, 0, 128)
        );
    }

    #[test]
    fn parses_named_colors_and_transparent() {
        assert_eq!(rgba8(parse_css_color("Tomato")), (255, 99, 71, 255));
        assert_eq!(rgba8(parse_css_color("transparent")), (0, 0, 0, 0));
    }

    #[test]
    fn unknown_input_falls_back_to_opaque_white() {
        assert!(try_parse_css_color("not-a-color").is_none());
        assert!(try_parse_css_color("rgba(1,2)").is_none());
        assert_eq!(rgba8(parse_css_color("rgba(")), (255, 255, 255, 255));
    }
}

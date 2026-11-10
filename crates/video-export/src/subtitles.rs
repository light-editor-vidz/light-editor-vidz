//! Sous-titres gravés : découpe mot à mot / lettre à lettre, remise sur la ligne de temps des
//! parties conservées, et génération du fichier .ass (libass) pour le filtre `subtitles` de ffmpeg.

use crate::plan::{Cue, Segment, SubtitleStyle};

pub const RAINBOW_PALETTE: [&str; 6] = [
    "#FF3B5C", "#FFB800", "#00E5A0", "#00B4FF", "#B14EFF", "#FF6EC7",
];

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Répartit une réplique en mots, la durée de chacun étant proportionnelle à sa longueur.
pub fn split_words_proportional(cue: &Cue) -> Vec<Event> {
    let words: Vec<&str> = cue.text.split_whitespace().collect();
    if words.is_empty() {
        return vec![];
    }
    let total: usize = words.iter().map(|w| w.chars().count()).sum();
    let duration = cue.end - cue.start;
    let mut t = cue.start;
    let mut out: Vec<Event> = words
        .iter()
        .map(|w| {
            let share = if total > 0 {
                w.chars().count() as f64 / total as f64
            } else {
                1.0 / words.len() as f64
            };
            let d = duration * share;
            let ev = Event {
                start: t,
                end: t + d,
                text: (*w).to_string(),
            };
            t += d;
            ev
        })
        .collect();
    if let Some(last) = out.last_mut() {
        last.end = cue.end;
    }
    out
}

/// Répartit une réplique lettre à lettre ; chaque événement porte le texte cumulé.
pub fn split_chars_proportional(cue: &Cue) -> Vec<Event> {
    let chars: Vec<char> = cue.text.chars().collect();
    if chars.is_empty() {
        return vec![];
    }
    let char_dur = (cue.end - cue.start) / chars.len() as f64;
    let mut t = cue.start;
    let mut cumulative = String::new();
    let mut out: Vec<Event> = chars
        .iter()
        .map(|c| {
            cumulative.push(*c);
            let ev = Event {
                start: t,
                end: t + char_dur,
                text: cumulative.clone(),
            };
            t += char_dur;
            ev
        })
        .collect();
    if let Some(last) = out.last_mut() {
        last.end = cue.end;
    }
    out
}

fn escape_ass_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace('\n', "\\N")
}

fn channels(hex: &str) -> (String, String, String) {
    let clean = hex.trim_start_matches('#');
    let clean = if clean.len() >= 6 { clean } else { "ffffff" };
    (
        clean[0..2].to_uppercase(),
        clean[2..4].to_uppercase(),
        clean[4..6].to_uppercase(),
    )
}

/// `&HBBGGRR&` — dans les balises de remplacement en ligne (`\1c…`).
pub fn ass_color_tag(hex: &str) -> String {
    let (r, g, b) = channels(hex);
    format!("&H{b}{g}{r}&")
}

/// `&HAABBGGRR` — dans les lignes `Style`. L'alpha ASS est INVERSÉ (00 = opaque, FF = transparent).
pub fn ass_color(hex: &str, alpha01: f64) -> String {
    let (r, g, b) = channels(hex);
    let alpha = ((1.0 - alpha01.clamp(0.0, 1.0)) * 255.0).round() as u8;
    format!("&H{alpha:02X}{b}{g}{r}")
}

struct Slide {
    x: i64,
    y_target: i64,
    y_start: i64,
}

fn slide_coords(w: u32, h: u32, position: &str) -> Slide {
    let x = (w as f64 / 2.0).round() as i64;
    let margin = (h as f64 * 0.06).round() as i64;
    let y_target = match position {
        "top" => margin,
        "middle" => (h as f64 / 2.0).round() as i64,
        _ => h as i64 - margin,
    };
    Slide {
        x,
        y_target,
        y_start: y_target + (h as f64 * 0.05).round() as i64,
    }
}

#[derive(Debug, Clone)]
pub struct ExpandOptions {
    pub video_width: u32,
    pub video_height: u32,
    pub position: String,
    pub color: String,
    pub accent_color: String,
}

impl Default for ExpandOptions {
    fn default() -> Self {
        Self {
            video_width: 1920,
            video_height: 1080,
            position: "bottom".into(),
            color: "#ffffff".into(),
            accent_color: "#22d3ee".into(),
        }
    }
}

/// Transforme les répliques (temps de la vidéo d'origine) en une liste plate d'événements dont
/// les balises ASS sont déjà posées, selon l'animation choisie.
pub fn expand_cues_to_events(cues: &[Cue], animation: &str, o: &ExpandOptions) -> Vec<Event> {
    let mut events = Vec::new();
    for cue in cues {
        match animation {
            "word-pop" => {
                for w in split_words_proportional(cue) {
                    events.push(Event {
                        start: w.start,
                        end: w.end,
                        text: format!(
                            "{{\\fscx60\\fscy60\\t(0,120,\\fscx100\\fscy100)}}{}",
                            escape_ass_text(&w.text)
                        ),
                    });
                }
            }
            "word-bounce" => {
                for w in split_words_proportional(cue) {
                    events.push(Event {
                        start: w.start,
                        end: w.end,
                        text: format!(
                            "{{\\fscx135\\fscy135\\t(0,80,\\fscx100\\fscy100)}}{}",
                            escape_ass_text(&w.text)
                        ),
                    });
                }
            }
            "rainbow" => {
                let text: Vec<String> = split_words_proportional(cue)
                    .iter()
                    .enumerate()
                    .map(|(i, w)| {
                        format!(
                            "{{\\1c{}}}{}",
                            ass_color_tag(RAINBOW_PALETTE[i % RAINBOW_PALETTE.len()]),
                            escape_ass_text(&w.text)
                        )
                    })
                    .collect();
                events.push(Event {
                    start: cue.start,
                    end: cue.end,
                    text: format!("{{\\fad(200,200)}}{}", text.join(" ")),
                });
            }
            "typewriter" => {
                for c in split_chars_proportional(cue) {
                    events.push(Event {
                        start: c.start,
                        end: c.end,
                        text: escape_ass_text(&c.text),
                    });
                }
            }
            "word-highlight" => {
                let words = split_words_proportional(cue);
                for (i, w) in words.iter().enumerate() {
                    let text: Vec<String> = words
                        .iter()
                        .enumerate()
                        .map(|(j, other)| {
                            let escaped = escape_ass_text(&other.text);
                            if j == i {
                                format!(
                                    "{{\\1c{}}}{escaped}{{\\1c{}}}",
                                    ass_color_tag(&o.accent_color),
                                    ass_color_tag(&o.color)
                                )
                            } else {
                                escaped
                            }
                        })
                        .collect();
                    events.push(Event {
                        start: w.start,
                        end: w.end,
                        text: text.join(" "),
                    });
                }
            }
            "sentence-slide" => {
                let s = slide_coords(o.video_width, o.video_height, &o.position);
                events.push(Event {
                    start: cue.start,
                    end: cue.end,
                    text: format!(
                        "{{\\move({},{},{},{},0,300)\\fad(300,0)}}{}",
                        s.x,
                        s.y_start,
                        s.x,
                        s.y_target,
                        escape_ass_text(&cue.text)
                    ),
                });
            }
            // sentence-fade, et repli pour un mode inconnu
            _ => events.push(Event {
                start: cue.start,
                end: cue.end,
                text: format!("{{\\fad(200,200)}}{}", escape_ass_text(&cue.text)),
            }),
        }
    }
    events
}

/// Les animations d'entrée (fondu, glissé, rebond) appartiennent à l'instant où une réplique
/// apparaît. La partie qui survit *après* une coupe est une continuation : elle ne doit pas
/// réapparaître en fondu ou en glissé.
fn strip_intro_animation(text: &str) -> String {
    fn remove_tag(s: &str, tag: &str) -> String {
        let mut out = String::new();
        let mut rest = s;
        while let Some(i) = rest.find(tag) {
            out.push_str(&rest[..i]);
            match rest[i..].find(')') {
                Some(end) => rest = &rest[i + end + 1..],
                None => {
                    rest = "";
                    break;
                }
            }
        }
        out.push_str(rest);
        out
    }
    let mut t = remove_tag(text, "\\fad(");
    t = remove_tag(&t, "\\move(");
    t = remove_tag(&t, "\\t(");
    t = t
        .replace("\\fscx60\\fscy60", "")
        .replace("\\fscx135\\fscy135", "");
    t.replace("{}", "")
}

/// Découpe chaque événement selon chaque segment conservé (temps réel) et décale les morceaux
/// restants sur la ligne de temps concaténée. Un événement à cheval sur une coupe est scindé.
pub fn remap_events_to_kept_segments(events: &[Event], kept: &[Segment]) -> Vec<Event> {
    let mut out = Vec::new();
    for ev in events {
        let mut offset = 0.0;
        for seg in kept {
            let clip_start = ev.start.max(seg.start);
            let clip_end = ev.end.min(seg.end);
            if clip_end > clip_start {
                out.push(Event {
                    text: if clip_start > ev.start {
                        strip_intro_animation(&ev.text)
                    } else {
                        ev.text.clone()
                    },
                    start: offset + (clip_start - seg.start),
                    end: offset + (clip_end - seg.start),
                });
            }
            offset += seg.end - seg.start;
        }
    }
    out
}

pub fn to_ass_time(seconds: f64) -> String {
    let total_cs = (seconds * 100.0).round().max(0.0) as u64;
    let cs = total_cs % 100;
    let total_sec = total_cs / 100;
    format!(
        "{}:{:02}:{:02}.{:02}",
        total_sec / 3600,
        (total_sec / 60) % 60,
        total_sec % 60,
        cs
    )
}

pub fn build_ass_content(
    events: &[Event],
    style: &SubtitleStyle,
    video_width: u32,
    video_height: u32,
) -> String {
    let font_size_px = ((style.font_size / 100.0) * video_height as f64)
        .round()
        .max(8.0) as i64;
    let alignment = match style.position.as_str() {
        "top" => 8,
        "middle" => 5,
        _ => 2,
    };
    let margin_v = (video_height as f64 * 0.06).round() as i64;
    // 4 = boîte peinte avec BackColour (extension libass) et texte contourné. 3, la boîte
    // « officielle », la peint avec OutlineColour et ignore couleur et opacité choisies.
    let border_style = if style.background_opacity > 0.0 { 4 } else { 1 };
    let header = format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {video_width}\nPlayResY: {video_height}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,{},{font_size_px},{},{},{},{},-1,0,0,0,100,100,0,0,{border_style},{},1,{alignment},20,20,{margin_v},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        style.font_family,
        ass_color(&style.color, 1.0),
        ass_color(&style.color, 1.0),
        ass_color(&style.outline_color, 1.0),
        ass_color(&style.background_color, style.background_opacity),
        style.outline_width,
    );
    // Les temps ASS ont une résolution de 10 ms : un événement plus court (un pas de machine à
    // écrire sur une réplique rapide) tombe à durée nulle et n'est jamais dessiné.
    let lines: Vec<String> = events
        .iter()
        .filter(|e| to_ass_time(e.start) != to_ass_time(e.end))
        .map(|e| {
            format!(
                "Dialogue: 0,{},{},Default,,0,0,0,,{}",
                to_ass_time(e.start),
                to_ass_time(e.end),
                e.text
            )
        })
        .collect();
    format!("{header}{}\n", lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(start: f64, end: f64, text: &str) -> Cue {
        Cue {
            start,
            end,
            text: text.into(),
        }
    }

    fn style() -> SubtitleStyle {
        SubtitleStyle {
            font_family: "Arial".into(),
            font_size: 5.0,
            color: "#ffffff".into(),
            outline_color: "#000000".into(),
            outline_width: 2.0,
            background_color: "#000000".into(),
            background_opacity: 0.0,
            position: "bottom".into(),
            accent_color: "#22d3ee".into(),
        }
    }

    #[test]
    fn words_share_the_duration_in_proportion_to_their_length() {
        let w = split_words_proportional(&cue(0.0, 10.0, "aa bbbbbb"));
        assert_eq!(w.len(), 2);
        assert!((w[0].end - 2.5).abs() < 1e-9 && w[1].start == w[0].end);
        assert_eq!(w[1].end, 10.0);
        assert!(split_words_proportional(&cue(0.0, 1.0, "   ")).is_empty());
    }

    #[test]
    fn characters_accumulate_over_the_cue() {
        let c = split_chars_proportional(&cue(0.0, 3.0, "abc"));
        assert_eq!(
            c.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(),
            ["a", "ab", "abc"]
        );
        assert_eq!(c[2].end, 3.0);
        assert!(split_chars_proportional(&cue(0.0, 1.0, "")).is_empty());
    }

    #[test]
    fn colours_are_written_blue_green_red_and_alpha_is_inverted() {
        assert_eq!(ass_color_tag("#ff8000"), "&H0080FF&");
        assert_eq!(ass_color("#ff8000", 1.0), "&H000080FF");
        assert_eq!(ass_color("#ff8000", 0.0), "&HFF0080FF");
        assert_eq!(ass_color("#000000", 0.5), "&H80000000");
    }

    #[test]
    fn text_is_escaped_for_ass() {
        assert_eq!(escape_ass_text("a{b}\\c\nd"), "a\\{b\\}\\\\c\\Nd");
    }

    #[test]
    fn every_animation_expands_to_the_expected_events() {
        let o = ExpandOptions::default();
        let c = [cue(0.0, 2.0, "hello big world")];
        assert_eq!(expand_cues_to_events(&c, "word-pop", &o).len(), 3);
        assert!(expand_cues_to_events(&c, "word-pop", &o)[0]
            .text
            .starts_with("{\\fscx60\\fscy60\\t(0,120,"));
        assert!(expand_cues_to_events(&c, "word-bounce", &o)[0]
            .text
            .starts_with("{\\fscx135"));
        assert_eq!(
            expand_cues_to_events(&c, "typewriter", &o).len(),
            "hello big world".chars().count()
        );
        let rainbow = expand_cues_to_events(&c, "rainbow", &o);
        assert_eq!(rainbow.len(), 1);
        assert!(
            rainbow[0]
                .text
                .starts_with("{\\fad(200,200)}{\\1c&H5C3BFF&}hello {\\1c")
                || rainbow[0].text.contains("&H5C3BFF&")
        );
        let highlight = expand_cues_to_events(&c, "word-highlight", &o);
        assert_eq!(highlight.len(), 3);
        assert!(
            highlight[1]
                .text
                .contains("{\\1c&HEED322&}big{\\1c&HFFFFFF&}"),
            "{}",
            highlight[1].text
        );
        assert!(expand_cues_to_events(&c, "sentence-slide", &o)[0]
            .text
            .starts_with("{\\move(960,"));
        assert!(expand_cues_to_events(&c, "sentence-fade", &o)[0]
            .text
            .starts_with("{\\fad(200,200)}hello"));
        assert!(expand_cues_to_events(&c, "unknown", &o)[0]
            .text
            .starts_with("{\\fad(200,200)}"));
    }

    #[test]
    fn the_slide_goes_up_to_the_position() {
        let top = slide_coords(1000, 1000, "top");
        assert_eq!((top.y_target, top.y_start), (60, 110));
        assert_eq!(slide_coords(1000, 1000, "middle").y_target, 500);
        assert_eq!(slide_coords(1000, 1000, "bottom").y_target, 940);
    }

    #[test]
    fn events_are_clipped_and_shifted_onto_the_kept_segments() {
        let events = [Event {
            start: 1.0,
            end: 7.0,
            text: "{\\fad(200,200)}x".into(),
        }];
        let kept = [
            Segment {
                start: 0.0,
                end: 3.0,
            },
            Segment {
                start: 5.0,
                end: 8.0,
            },
        ];
        let out = remap_events_to_kept_segments(&events, &kept);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].start, out[0].end), (1.0, 3.0));
        assert_eq!((out[1].start, out[1].end), (3.0, 5.0));
        // La première morceau garde son entrée, la continuation ne rejoue pas le fondu.
        assert_eq!(out[0].text, "{\\fad(200,200)}x");
        assert_eq!(out[1].text, "x");
    }

    #[test]
    fn an_event_inside_a_cut_disappears() {
        let events = [Event {
            start: 3.5,
            end: 4.5,
            text: "x".into(),
        }];
        let kept = [
            Segment {
                start: 0.0,
                end: 3.0,
            },
            Segment {
                start: 5.0,
                end: 8.0,
            },
        ];
        assert!(remap_events_to_kept_segments(&events, &kept).is_empty());
    }

    #[test]
    fn the_intro_tags_are_stripped_from_a_continuation() {
        assert_eq!(
            strip_intro_animation("{\\move(1,2,3,4,0,300)\\fad(300,0)}hi"),
            "hi"
        );
        assert_eq!(
            strip_intro_animation("{\\fscx60\\fscy60\\t(0,120,\\fscx100\\fscy100)}hi"),
            "hi"
        );
    }

    #[test]
    fn ass_times_use_centiseconds() {
        assert_eq!(to_ass_time(0.0), "0:00:00.00");
        assert_eq!(to_ass_time(61.234), "0:01:01.23");
        assert_eq!(to_ass_time(3661.5), "1:01:01.50");
        assert_eq!(to_ass_time(-3.0), "0:00:00.00");
    }

    #[test]
    fn the_ass_file_has_a_style_matching_the_options_and_skips_zero_length_events() {
        let mut s = style();
        s.position = "top".into();
        s.background_opacity = 0.5;
        let events = [
            Event {
                start: 0.0,
                end: 1.0,
                text: "hi".into(),
            },
            Event {
                start: 2.0,
                end: 2.001,
                text: "gone".into(),
            },
        ];
        let ass = build_ass_content(&events, &s, 1920, 1080);
        assert!(ass.contains("PlayResX: 1920") && ass.contains("PlayResY: 1080"));
        // 5 % de 1080 = 54 px ; bordure de style 4 car le fond est visible ; alignement haut = 8.
        assert!(ass.contains("Style: Default,Arial,54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,4,2,1,8,20,20,65,1"), "{ass}");
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,hi"));
        assert!(!ass.contains("gone"));
        assert!(ass.ends_with("hi\n"));
    }

    #[test]
    fn without_a_background_the_border_style_is_an_outline() {
        let ass = build_ass_content(&[], &style(), 1280, 720);
        assert!(ass.contains(",0,0,1,2,1,2,20,20,43,1"));
    }
}

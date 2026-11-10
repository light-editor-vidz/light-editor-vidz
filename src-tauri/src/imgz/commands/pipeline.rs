//! Ajustements et filtres exposés par deux commandes génériques.
//!
//! Le front envoie la même description (`{ type: "sepia", intensity: 0.8 }`) pour
//! **appliquer** un réglage et pour en demander l'**aperçu** : les deux passent par le
//! même code, l'aperçu étant simplement calculé sur une version réduite de l'image sans
//! toucher à l'historique. Il n'y a donc plus de formule CSS qui divergerait du rendu final.

use image::DynamicImage;
use serde::Deserialize;
use tauri::State;

use super::open::{encode_preview, ImageMeta};
use super::ops::{apply_step, snapshot};
use super::steps::Step;
use super::{adjustments as adj, filters as fil, transform};
use crate::imgz::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Op {
    BrightnessContrast {
        brightness: f32,
        contrast: f32,
    },
    Exposure {
        exposure: f32,
    },
    HueSaturation {
        hue: f32,
        saturation: f32,
        lightness: f32,
    },
    Vibrance {
        vibrance: f32,
    },
    Levels {
        in_black: u8,
        in_white: u8,
        gamma: f32,
        out_black: u8,
        out_white: u8,
    },
    Curves {
        points: Vec<[f32; 2]>,
    },
    WhiteBalance {
        temperature: f32,
        tint: f32,
    },
    Sharpen {
        amount: f32,
        radius: f32,
        threshold: u8,
    },
    Denoise {
        strength: f32,
    },
    Grayscale {
        r_weight: f32,
        g_weight: f32,
        b_weight: f32,
    },
    Sepia {
        intensity: f32,
    },
    Invert,
    Vignette {
        strength: f32,
        feather: f32,
    },
    Grain {
        amount: f32,
        monochrome: bool,
    },
    Pixelate {
        size: u32,
    },
    Posterize {
        levels: u8,
    },
    Duotone {
        shadow_r: u8,
        shadow_g: u8,
        shadow_b: u8,
        highlight_r: u8,
        highlight_g: u8,
        highlight_b: u8,
    },
    Sketch,
    Lomo {
        intensity: f32,
    },
    Vintage {
        intensity: f32,
    },
    Cool {
        intensity: f32,
    },
    Warm {
        intensity: f32,
    },
    Fade {
        intensity: f32,
    },
    Drama {
        intensity: f32,
    },
    CrossProcess {
        intensity: f32,
    },
    BlurGaussian {
        radius: f32,
    },
    BlurMotion {
        angle: f32,
        distance: u32,
    },
    BlurRadial {
        strength: f32,
        samples: u32,
    },
    /// Rotation : utilisée pour l'aperçu de l'angle avant application.
    Rotate {
        degrees: f64,
    },
}

impl Op {
    pub fn apply(&self, img: &DynamicImage) -> Result<DynamicImage, String> {
        Ok(match self {
            Op::BrightnessContrast {
                brightness,
                contrast,
            } => adj::brightness_contrast(img, *brightness, *contrast),
            Op::Exposure { exposure } => adj::exposure(img, *exposure),
            Op::HueSaturation {
                hue,
                saturation,
                lightness,
            } => adj::hue_saturation(img, *hue, *saturation, *lightness),
            Op::Vibrance { vibrance } => adj::vibrance(img, *vibrance),
            Op::Levels {
                in_black,
                in_white,
                gamma,
                out_black,
                out_white,
            } => adj::levels(img, *in_black, *in_white, *gamma, *out_black, *out_white),
            Op::Curves { points } => adj::curves(img, points),
            Op::WhiteBalance { temperature, tint } => adj::white_balance(img, *temperature, *tint),
            Op::Sharpen {
                amount,
                radius,
                threshold,
            } => adj::sharpen(img, *amount, *radius, *threshold),
            Op::Denoise { strength } => adj::denoise(img, *strength),
            Op::Grayscale {
                r_weight,
                g_weight,
                b_weight,
            } => fil::grayscale(img, *r_weight, *g_weight, *b_weight),
            Op::Sepia { intensity } => fil::sepia(img, *intensity),
            Op::Invert => fil::invert(img),
            Op::Vignette { strength, feather } => fil::vignette(img, *strength, *feather),
            Op::Grain { amount, monochrome } => fil::grain(img, *amount, *monochrome),
            Op::Pixelate { size } => fil::pixelate(img, *size),
            Op::Posterize { levels } => fil::posterize(img, *levels),
            Op::Duotone {
                shadow_r,
                shadow_g,
                shadow_b,
                highlight_r,
                highlight_g,
                highlight_b,
            } => fil::duotone(
                img,
                [*shadow_r, *shadow_g, *shadow_b],
                [*highlight_r, *highlight_g, *highlight_b],
            ),
            Op::Sketch => fil::sketch(img),
            Op::Lomo { intensity } => fil::lomo(img, *intensity),
            Op::Vintage { intensity } => fil::vintage(img, *intensity),
            Op::Cool { intensity } => fil::cool(img, *intensity),
            Op::Warm { intensity } => fil::warm(img, *intensity),
            Op::Fade { intensity } => fil::fade(img, *intensity),
            Op::Drama { intensity } => fil::drama(img, *intensity),
            Op::CrossProcess { intensity } => fil::cross_process(img, *intensity),
            Op::BlurGaussian { radius } => fil::blur_gaussian(img, *radius),
            Op::BlurMotion { angle, distance } => fil::blur_motion(img, *angle, *distance),
            Op::BlurRadial { strength, samples } => fil::blur_radial(img, *strength, *samples),
            Op::Rotate { degrees } => transform::rotate_dynamic(img, *degrees)?,
        })
    }

    /// Même réglage pour une image réduite d'un facteur `k` (< 1) : les paramètres exprimés
    /// en pixels sont ramenés à l'échelle, pour que l'aperçu ressemble au rendu final.
    pub fn scaled(&self, k: f32) -> Op {
        let px = |v: f32, min: f32| (v * k).max(min);
        match self.clone() {
            Op::Sharpen {
                amount,
                radius,
                threshold,
            } => Op::Sharpen {
                amount,
                radius: px(radius, 0.1),
                threshold,
            },
            Op::Pixelate { size } => Op::Pixelate {
                size: ((size as f32 * k).round() as u32).max(1),
            },
            Op::BlurGaussian { radius } => Op::BlurGaussian {
                radius: px(radius, 0.1),
            },
            Op::BlurMotion { angle, distance } => Op::BlurMotion {
                angle,
                distance: ((distance as f32 * k).round() as u32).max(1),
            },
            other => other,
        }
    }
}

/// Applique un ajustement ou un filtre à l'image courante de l'onglet.
#[tauri::command(async)]
pub fn apply_command(
    state: State<'_, AppState>,
    tab_id: String,
    command: Op,
    replace: Option<bool>,
) -> Result<ImageMeta, String> {
    let step = match command {
        Op::Rotate { degrees } => Step::Rotate { degrees },
        other => Step::Adjust(other),
    };
    apply_step(&state, &tab_id, replace.unwrap_or(false), step)
}

/// Aperçu d'un réglage : PNG (data URL) de l'image réduite à `max_side` pixels de côté,
/// calculé sans modifier l'historique.
#[tauri::command(async)]
pub fn preview_command(
    state: State<'_, AppState>,
    tab_id: String,
    command: Op,
    max_side: u32,
) -> Result<String, String> {
    let snap = snapshot(&state, &tab_id)?;
    let max_side = max_side.clamp(16, 4096);
    let img = &snap.image;
    let (small, k) = if img.width().max(img.height()) > max_side {
        let small = img.thumbnail(max_side, max_side);
        let k = small.width() as f32 / img.width() as f32;
        (small, k)
    } else {
        ((**img).clone(), 1.0)
    };
    encode_preview(&command.scaled(k).apply(&small)?)
}

/// Enveloppes aux signatures d'origine, pour que les tests des modules d'ajustements et de
/// filtres continuent de s'écrire commande par commande.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub mod compat {
    use super::*;

    macro_rules! shim {
        ($name:ident => $variant:ident { $($f:ident : $t:ty),* $(,)? }) => {
            pub fn $name(
                state: State<'_, AppState>,
                tab_id: String,
                $($f: $t),*
            ) -> Result<ImageMeta, String> {
                apply_command(state, tab_id, Op::$variant { $($f),* }, None)
            }
        };
        ($name:ident => $variant:ident) => {
            pub fn $name(state: State<'_, AppState>, tab_id: String) -> Result<ImageMeta, String> {
                apply_command(state, tab_id, Op::$variant, None)
            }
        };
    }

    shim!(adjust_brightness_contrast => BrightnessContrast { brightness: f32, contrast: f32 });
    shim!(adjust_exposure => Exposure { exposure: f32 });
    shim!(adjust_hue_saturation => HueSaturation { hue: f32, saturation: f32, lightness: f32 });
    shim!(adjust_vibrance => Vibrance { vibrance: f32 });
    shim!(adjust_levels => Levels { in_black: u8, in_white: u8, gamma: f32, out_black: u8, out_white: u8 });
    shim!(adjust_curves => Curves { points: Vec<[f32; 2]> });
    shim!(adjust_white_balance => WhiteBalance { temperature: f32, tint: f32 });
    shim!(adjust_sharpen => Sharpen { amount: f32, radius: f32, threshold: u8 });
    shim!(adjust_denoise => Denoise { strength: f32 });
    shim!(filter_grayscale => Grayscale { r_weight: f32, g_weight: f32, b_weight: f32 });
    shim!(filter_sepia => Sepia { intensity: f32 });
    shim!(filter_invert => Invert);
    shim!(filter_vignette => Vignette { strength: f32, feather: f32 });
    shim!(filter_grain => Grain { amount: f32, monochrome: bool });
    shim!(filter_pixelate => Pixelate { size: u32 });
    shim!(filter_posterize => Posterize { levels: u8 });
    shim!(filter_duotone => Duotone { shadow_r: u8, shadow_g: u8, shadow_b: u8, highlight_r: u8, highlight_g: u8, highlight_b: u8 });
    shim!(filter_sketch => Sketch);
    shim!(filter_lomo => Lomo { intensity: f32 });
    shim!(filter_vintage => Vintage { intensity: f32 });
    shim!(filter_cool => Cool { intensity: f32 });
    shim!(filter_warm => Warm { intensity: f32 });
    shim!(filter_fade => Fade { intensity: f32 });
    shim!(filter_drama => Drama { intensity: f32 });
    shim!(filter_cross_process => CrossProcess { intensity: f32 });
    shim!(filter_blur_gaussian => BlurGaussian { radius: f32 });
    shim!(filter_blur_motion => BlurMotion { angle: f32, distance: u32 });
    shim!(filter_blur_radial => BlurRadial { strength: f32, samples: u32 });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imgz::test_support::{gradient, solid, Harness, TAB};

    fn parse(json: &str) -> Op {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn commands_are_described_by_a_kebab_case_type_and_camel_case_fields() {
        assert!(matches!(
            parse(r#"{"type":"brightness-contrast","brightness":5,"contrast":-5}"#),
            Op::BrightnessContrast { .. }
        ));
        assert!(matches!(
            parse(
                r#"{"type":"levels","inBlack":1,"inWhite":250,"gamma":1.0,"outBlack":0,"outWhite":255}"#
            ),
            Op::Levels {
                in_black: 1,
                in_white: 250,
                ..
            }
        ));
        assert!(matches!(
            parse(
                r#"{"type":"duotone","shadowR":1,"shadowG":2,"shadowB":3,"highlightR":4,"highlightG":5,"highlightB":6}"#
            ),
            Op::Duotone {
                shadow_b: 3,
                highlight_r: 4,
                ..
            }
        ));
        assert!(matches!(
            parse(r#"{"type":"cross-process","intensity":1}"#),
            Op::CrossProcess { .. }
        ));
        assert!(matches!(
            parse(r#"{"type":"blur-motion","angle":10,"distance":4}"#),
            Op::BlurMotion { .. }
        ));
        assert!(matches!(parse(r#"{"type":"invert"}"#), Op::Invert));
        assert!(matches!(parse(r#"{"type":"sketch"}"#), Op::Sketch));
    }

    #[test]
    fn an_unknown_command_type_is_rejected() {
        assert!(serde_json::from_str::<Op>(r#"{"type":"nope"}"#).is_err());
    }

    #[test]
    fn applying_a_command_pushes_one_history_step() {
        let h = Harness::with_image(solid(4, 4, [10, 20, 30]));

        let meta = apply_command(h.state(), TAB.into(), Op::Invert, None).unwrap();

        assert_eq!(h.pixel(0, 0), [245, 235, 225, 255]);
        assert_eq!((meta.history_len, meta.history_index), (2, 1));
        assert!(meta.can_undo && !meta.can_redo);
    }

    #[test]
    fn a_command_needs_a_tab_and_an_image() {
        assert_eq!(
            apply_command(Harness::empty().state(), TAB.into(), Op::Invert, None).unwrap_err(),
            "Tab not found"
        );
        assert_eq!(
            apply_command(
                Harness::without_image().state(),
                TAB.into(),
                Op::Invert,
                None
            )
            .unwrap_err(),
            "No image loaded"
        );
    }

    #[test]
    fn a_preview_does_not_touch_the_history() {
        let h = Harness::with_image(gradient(40, 20));

        let preview = preview_command(h.state(), TAB.into(), Op::Invert, 16).unwrap();

        assert!(preview.starts_with("data:image/png;base64,"));
        assert_eq!(h.history_len(), 1);
    }

    #[test]
    fn a_preview_is_reduced_to_the_requested_size() {
        let h = Harness::with_image(solid(400, 200, [1, 2, 3]));

        let preview =
            preview_command(h.state(), TAB.into(), Op::Sepia { intensity: 1.0 }, 100).unwrap();

        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            preview.trim_start_matches("data:image/png;base64,"),
        )
        .unwrap();
        let img = image::load_from_memory(&bytes).unwrap();
        assert_eq!((img.width(), img.height()), (100, 50));
    }

    #[test]
    fn pixel_sized_parameters_follow_the_preview_scale() {
        match (Op::BlurGaussian { radius: 20.0 }).scaled(0.25) {
            Op::BlurGaussian { radius } => assert!((radius - 5.0).abs() < 1e-6),
            _ => panic!(),
        }
        match (Op::Pixelate { size: 40 }).scaled(0.25) {
            Op::Pixelate { size } => assert_eq!(size, 10),
            _ => panic!(),
        }
        assert!(matches!((Op::Invert).scaled(0.5), Op::Invert));
    }

    #[test]
    fn a_rotation_preview_uses_the_real_rotation() {
        let h = Harness::with_image(solid(40, 20, [9, 9, 9]));
        assert!(preview_command(h.state(), TAB.into(), Op::Rotate { degrees: 90.0 }, 64).is_ok());
    }
}

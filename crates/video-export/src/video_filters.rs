//! Chaînes de filtres vidéo ffmpeg de l'export : recadrage, rotation, perspective, couleur,
//! vitesse, mise au format d'un réseau social, résolution.

pub const ASPECTS: [&str; 4] = ["9:16", "4:5", "1:1", "16:9"];
pub const REFRAME_MODES: [&str; 2] = ["blur", "crop"];

/// Dernier garde-fou : une taille impaire ferait retomber libx264 en yuv444p, illisible sur la
/// plupart des lecteurs. On termine toujours sur des dimensions paires.
pub const EVEN_DIMENSIONS: &str = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Reframe {
    pub aspect: String,
    pub mode: String,
}

/// Rotation totale en degrés. 450° et −270° sont un quart de tour : repliés dans [0, 360) pour
/// retrouver les transpositions sans perte.
pub fn rotation_filter(total: f64) -> Option<String> {
    let total = ((total % 360.0) + 360.0) % 360.0;
    if total == 0.0 {
        None
    } else if total == 90.0 {
        Some("transpose=1".into())
    } else if total == 180.0 {
        Some("transpose=1,transpose=1".into())
    } else if total == 270.0 {
        Some("transpose=2".into())
    } else {
        // Angle quelconque : ow/oh agrandissent le canevas pour contenir l'image tournée.
        Some(format!(
            "rotate={total}*PI/180:ow=rotw({total}*PI/180):oh=roth({total}*PI/180)"
        ))
    }
}

pub fn perspective_filter(h: f64, v: f64) -> Option<String> {
    if h == 0.0 && v == 0.0 {
        return None;
    }
    let h_rad = h.to_radians();
    let v_rad = v.to_radians();
    if h != 0.0 && v == 0.0 {
        let s = h_rad.sin() * 0.2;
        return Some(format!(
            "perspective=x0=0:y0=-H*{s}:x1=W:y1=H*{s}:x2=0:y2=H+H*{s}:x3=W:y3=H-H*{s}:sense=destination"
        ));
    }
    if v != 0.0 && h == 0.0 {
        let s = v_rad.sin() * 0.2;
        return Some(format!(
            "perspective=x0=-W*{s}:y0=0:x1=W+W*{s}:y1=0:x2=W*{s}:y2=H:x3=W-W*{s}:y3=H:sense=destination"
        ));
    }
    let sh = h_rad.sin() * 0.2;
    let sv = v_rad.sin() * 0.2;
    Some(format!(
        "perspective=x0=-W*{sv}:y0=-H*{sh}:x1=W+W*{sv}:y1=H*{sh}:x2=W*{sv}:y2=H+H*{sh}:x3=W-W*{sv}:y3=H-H*{sh}:sense=destination"
    ))
}

/// Arrondi à l'entier pair inférieur (jamais supérieur : le recadrage reste dans l'image).
pub fn to_even(n: f64) -> i64 {
    ((n.round() as i64) / 2 * 2).max(2)
}

pub fn crop_filter(crop: Option<Crop>) -> Option<String> {
    crop.map(|c| {
        format!(
            "crop={}:{}:{}:{}",
            to_even(c.w),
            to_even(c.h),
            c.x.round() as i64,
            c.y.round() as i64
        )
    })
}

pub fn speed_filter(speed: f64) -> Option<String> {
    if speed == 1.0 {
        None
    } else {
        Some(format!("setpts={:.4}*PTS", 1.0 / speed))
    }
}

/// Jamais d'agrandissement : un 4K exporté en « 1080p » est réduit, un 480p reste en 480p.
pub fn resolution_filter(max_height: Option<u32>) -> Option<String> {
    max_height.map(|h| format!("scale=-2:'min({h},ih)'"))
}

/// « 9:16 » → « (9/16) », sûr à multiplier ou diviser dans une expression ffmpeg.
fn ratio_expression(aspect: &str) -> String {
    format!("({})", aspect.replace(':', "/"))
}

/// Ajuste l'image à un ratio cible. `crop` : la plus grande zone centrée de ce ratio ; `blur` :
/// l'image entière, centrée sur une copie floutée agrandie qui remplit le canevas.
pub fn reframe_filter(reframe: Option<&Reframe>) -> Option<String> {
    let reframe = reframe?;
    let r = ratio_expression(&reframe.aspect);
    if reframe.mode == "crop" {
        let even_down = |expr: String| format!("trunc(({expr})/2)*2");
        return Some(format!(
            "crop=w='{}':h='{}'",
            even_down(format!("min(iw,ih*{r})")),
            even_down(format!("min(ih,iw/{r})"))
        ));
    }
    // Le canevas est arrondi au pair *supérieur* : la couche floue n'est jamais plus petite
    // que l'image posée dessus.
    let even_up = |expr: String| format!("trunc((({expr})+1)/2)*2");
    Some(
        [
            "split[rf0][rf1]".to_string(),
            format!(
                "[rf1]scale=w='{}':h='{}':force_original_aspect_ratio=increase,crop=w='min(iw,ih*{r})':h='min(ih,iw/{r})',boxblur=luma_radius='min(w,h)/24':luma_power=2:chroma_radius='min(cw,ch)/24':chroma_power=2[rfbg]",
                even_up(format!("max(iw,ih*{r})")),
                even_up(format!("max(ih,iw/{r})"))
            ),
            "[rfbg][rf0]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2".to_string(),
        ]
        .join(";"),
    )
}

/// Pour une vidéo recadrée au format d'un réseau, « 1080p » désigne le petit côté.
pub fn short_side_filter(max_short_side: Option<u32>) -> Option<String> {
    max_short_side
        .map(|m| format!("scale=w='if(gt(iw,ih),-2,min({m},iw))':h='if(gt(iw,ih),min({m},ih),-2)'"))
}

#[derive(Debug, Clone, Default)]
pub struct VideoFilterParams {
    pub rotation: f64,
    pub straighten: f64,
    pub perspective_h: f64,
    pub perspective_v: f64,
    pub crop: Option<Crop>,
    pub color_filter: String,
    pub speed: Option<f64>,
    pub max_height: Option<u32>,
    pub reframe: Option<Reframe>,
}

/// La chaîne complète, dans l'ordre : le recadrage d'abord (sa boîte est dessinée sur l'image non
/// tournée), puis rotation, perspective, couleur, vitesse, mise au format, résolution, et enfin
/// des dimensions paires.
pub fn build_video_filters(p: &VideoFilterParams) -> Vec<String> {
    [
        crop_filter(p.crop),
        rotation_filter(p.rotation + p.straighten),
        perspective_filter(p.perspective_h, p.perspective_v),
        (!p.color_filter.is_empty()).then(|| p.color_filter.clone()),
        speed_filter(p.speed.unwrap_or(1.0)),
        reframe_filter(p.reframe.as_ref()),
        if p.reframe.is_some() {
            short_side_filter(p.max_height)
        } else {
            resolution_filter(p.max_height)
        },
        Some(EVEN_DIMENSIONS.to_string()),
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quarter_turns_use_lossless_transposes_whatever_the_sign() {
        assert_eq!(rotation_filter(0.0), None);
        assert_eq!(rotation_filter(360.0), None);
        assert_eq!(rotation_filter(90.0).as_deref(), Some("transpose=1"));
        assert_eq!(rotation_filter(450.0).as_deref(), Some("transpose=1"));
        assert_eq!(rotation_filter(-90.0).as_deref(), Some("transpose=2"));
        assert_eq!(rotation_filter(-270.0).as_deref(), Some("transpose=1"));
        assert_eq!(
            rotation_filter(180.0).as_deref(),
            Some("transpose=1,transpose=1")
        );
    }

    #[test]
    fn an_arbitrary_angle_grows_the_canvas() {
        let f = rotation_filter(12.0).unwrap();
        assert!(
            f.starts_with("rotate=12*PI/180:ow=rotw(12*PI/180):oh=roth(12*PI/180)"),
            "{f}"
        );
    }

    #[test]
    fn perspective_is_off_without_angles_and_has_three_variants() {
        assert_eq!(perspective_filter(0.0, 0.0), None);
        assert!(perspective_filter(10.0, 0.0).unwrap().contains("y0=-H*"));
        assert!(perspective_filter(0.0, 10.0).unwrap().contains("x0=-W*"));
        let both = perspective_filter(10.0, 10.0).unwrap();
        assert!(both.contains("x0=-W*") && both.contains("y0=-H*"));
        assert!(both.ends_with("sense=destination"));
    }

    #[test]
    fn crop_sizes_are_even_and_never_below_two() {
        assert_eq!(to_even(101.0), 100);
        assert_eq!(to_even(1.0), 2);
        let f = crop_filter(Some(Crop {
            x: 10.4,
            y: 20.6,
            w: 101.0,
            h: 55.0,
        }))
        .unwrap();
        assert_eq!(f, "crop=100:54:10:21");
        assert_eq!(crop_filter(None), None);
    }

    #[test]
    fn speed_is_a_pts_factor() {
        assert_eq!(speed_filter(1.0), None);
        assert_eq!(speed_filter(2.0).as_deref(), Some("setpts=0.5000*PTS"));
        assert_eq!(speed_filter(0.5).as_deref(), Some("setpts=2.0000*PTS"));
    }

    #[test]
    fn resolution_never_upscales() {
        assert_eq!(resolution_filter(None), None);
        assert_eq!(
            resolution_filter(Some(1080)).as_deref(),
            Some("scale=-2:'min(1080,ih)'")
        );
    }

    #[test]
    fn a_crop_reframe_is_the_largest_centred_area_of_the_ratio() {
        let f = reframe_filter(Some(&Reframe {
            aspect: "9:16".into(),
            mode: "crop".into(),
        }))
        .unwrap();
        assert!(
            f.starts_with("crop=w='trunc((min(iw,ih*(9/16)))/2)*2'"),
            "{f}"
        );
    }

    #[test]
    fn a_blur_reframe_overlays_the_frame_on_a_blurred_copy() {
        let f = reframe_filter(Some(&Reframe {
            aspect: "1:1".into(),
            mode: "blur".into(),
        }))
        .unwrap();
        assert!(f.starts_with("split[rf0][rf1];[rf1]scale="));
        assert!(
            f.contains("boxblur=")
                && f.ends_with("overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2")
        );
    }

    #[test]
    fn short_side_resolution_applies_to_the_shorter_side() {
        let f = short_side_filter(Some(1080)).unwrap();
        assert!(f.contains("if(gt(iw,ih),-2,min(1080,iw))"));
    }

    #[test]
    fn the_chain_runs_crop_first_and_ends_on_even_dimensions() {
        let chain = build_video_filters(&VideoFilterParams {
            rotation: 90.0,
            crop: Some(Crop {
                x: 0.0,
                y: 0.0,
                w: 200.0,
                h: 100.0,
            }),
            color_filter: "hue=s=0".into(),
            speed: Some(2.0),
            max_height: Some(720),
            ..Default::default()
        });
        assert_eq!(chain[0], "crop=200:100:0:0");
        assert_eq!(chain[1], "transpose=1");
        assert_eq!(chain[2], "hue=s=0");
        assert_eq!(chain[3], "setpts=0.5000*PTS");
        assert_eq!(chain[4], "scale=-2:'min(720,ih)'");
        assert_eq!(chain.last().unwrap(), EVEN_DIMENSIONS);
    }

    #[test]
    fn a_reframed_video_uses_the_short_side_for_its_resolution() {
        let chain = build_video_filters(&VideoFilterParams {
            reframe: Some(Reframe {
                aspect: "9:16".into(),
                mode: "crop".into(),
            }),
            max_height: Some(1080),
            ..Default::default()
        });
        assert!(chain.iter().any(|f| f.contains("if(gt(iw,ih)")));
        assert!(!chain.iter().any(|f| f.starts_with("scale=-2:")));
    }

    #[test]
    fn the_default_chain_is_only_the_even_guard() {
        assert_eq!(
            build_video_filters(&VideoFilterParams::default()),
            vec![EVEN_DIMENSIONS]
        );
    }
}

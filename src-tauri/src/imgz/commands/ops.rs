//! Squelette commun des commandes qui modifient l'image d'un onglet.
//!
//! Le verrou global n'est tenu que le temps de lire ou d'écrire l'historique : le calcul
//! et l'encodage de l'aperçu (plusieurs secondes sur une grande photo) se font hors verrou,
//! si bien qu'une opération longue ne bloque ni les autres onglets ni l'annulation.
//! L'aperçu est encodé **avant** l'empilement : une erreur d'encodage ne laisse donc jamais
//! dans l'historique une étape que l'interface n'a pas reçue.

use image::DynamicImage;
use std::sync::Arc;

use super::open::{build_meta_with, meta_from, thumbnail_of, ImageMeta};
use super::steps::{active_tools, Step, Tool};
use crate::imgz::{AppHistory, AppState};
use serde::Serialize;

type ThumbCache = std::sync::Mutex<std::collections::VecDeque<(String, String)>>;

fn thumbnails() -> &'static ThumbCache {
    static CACHE: std::sync::OnceLock<ThumbCache> = std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn cached_thumbnail(url: &str) -> Option<String> {
    let cache = thumbnails().lock().unwrap_or_else(|e| e.into_inner());
    cache.iter().find(|(k, _)| k == url).map(|(_, v)| v.clone())
}

fn remember_thumbnail(url: &str, thumbnail: &str) {
    let mut cache = thumbnails().lock().unwrap_or_else(|e| e.into_inner());
    cache.push_back((url.to_string(), thumbnail.to_string()));
    while cache.len() > 48 {
        cache.pop_front();
    }
}

/// État d'un onglet à un instant donné, copié hors du verrou.
pub struct Snapshot {
    pub image: Arc<DynamicImage>,
    pub format: String,
    pub can_undo: bool,
    pub can_redo: bool,
    pub len: usize,
    pub index: usize,
    /// URL `lcimg` de l'image.
    pub url: String,
    pub tools: Vec<String>,
}

impl Snapshot {
    pub fn of(tab_id: &str, history: &AppHistory) -> Result<Snapshot, String> {
        let image = history.current_arc().ok_or("No image loaded")?;
        Ok(Snapshot {
            image,
            format: history.format.clone(),
            can_undo: history.can_undo(),
            can_redo: history.can_redo(),
            len: history.entries.len(),
            index: history.index.unwrap_or(0),
            url: history.image_url(tab_id),
            tools: active_tools(&history.current_log()),
        })
    }

    /// Métadonnées (dont l'aperçu encodé) de cet état.
    pub fn meta(&self) -> Result<ImageMeta, String> {
        // La vignette d'une étape ne change jamais (l'URL porte l'époque et l'étape) : elle n'est
        // recalculée ni encodée à chaque navigation dans l'historique.
        let thumbnail = match cached_thumbnail(&self.url) {
            Some(hit) => hit,
            None => {
                let made = thumbnail_of(&self.image)?;
                remember_thumbnail(&self.url, &made);
                made
            }
        };
        let mut meta = meta_from(
            &self.image,
            &self.format,
            self.can_undo,
            self.can_redo,
            self.url.clone(),
            thumbnail,
        );
        meta.history_len = self.len;
        meta.history_index = self.index;
        meta.tools = self.tools.clone();
        Ok(meta)
    }
}

/// Copie l'état courant de l'onglet puis relâche le verrou.
pub fn snapshot(state: &AppState, tab_id: &str) -> Result<Snapshot, String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    Snapshot::of(tab_id, map.get(tab_id).ok_or("Tab not found")?)
}

/// Calcule la prochaine image à partir de la courante et l'empile.
///
/// L'aperçu est encodé **avant** l'empilement : une erreur d'encodage ne laisse donc jamais
/// dans l'historique une étape que l'interface n'a pas reçue. Cette variante ne tient pas de
/// journal : les commandes de production passent par [`apply_step`].
#[cfg(test)]
pub fn apply_op<F>(state: &AppState, tab_id: &str, op: F) -> Result<ImageMeta, String>
where
    F: FnOnce(&DynamicImage) -> Result<DynamicImage, String>,
{
    apply_op_with(state, tab_id, false, op)
}

/// Comme [`apply_op`], mais avec `replace` le calcul repart de l'image **précédant** la
/// dernière étape, qui est remplacée : c'est ce qui permet de reprendre un curseur de
/// réglage sans empiler les effets les uns sur les autres.
#[cfg(test)]
pub fn apply_op_with<F>(
    state: &AppState,
    tab_id: &str,
    replace: bool,
    op: F,
) -> Result<ImageMeta, String>
where
    F: FnOnce(&DynamicImage) -> Result<DynamicImage, String>,
{
    apply_core(state, tab_id, replace, None, op)
}

/// Applique une opération et la consigne dans le journal de la nouvelle étape.
pub fn apply_step(
    state: &AppState,
    tab_id: &str,
    replace: bool,
    step: Step,
) -> Result<ImageMeta, String> {
    apply_core(state, tab_id, replace, Some(step.clone()), |img| {
        step.apply(img)
    })
}

fn apply_core<F>(
    state: &AppState,
    tab_id: &str,
    replace: bool,
    step: Option<Step>,
    op: F,
) -> Result<ImageMeta, String>
where
    F: FnOnce(&DynamicImage) -> Result<DynamicImage, String>,
{
    let (source, format, base_log, seen) = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        let history = map.get(tab_id).ok_or("Tab not found")?;
        let current = history.index.ok_or("No image loaded")?;
        let from = if replace && current > 0 {
            current - 1
        } else {
            current
        };
        (
            Arc::clone(&history.entries[from]),
            history.format.clone(),
            Arc::clone(&history.logs[from]),
            (history.epoch, history.index),
        )
    };
    let next = op(&source)?;
    let mut log = (*base_log).clone();
    log.extend(step);
    commit(state, tab_id, &format, next, Arc::new(log), replace, seen)
}

/// Empile `next` (et son journal) et renvoie ses métadonnées.
fn commit(
    state: &AppState,
    tab_id: &str,
    format: &str,
    next: DynamicImage,
    log: Arc<Vec<Step>>,
    replace: bool,
    seen: (u64, Option<usize>),
) -> Result<ImageMeta, String> {
    // Les miniatures d'abord, l'empilement ensuite : en cas d'échec, rien n'a changé.
    let mut meta = build_meta_with(&next, format, false, false, String::new())?;

    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let history = map.get_mut(tab_id).ok_or("Tab not found")?;
    // Annuler, rétablir ou une autre retouche pendant le calcul : empiler ce résultat sur l'index
    // courant ferait réapparaître un effet annulé, ou calculé sur une autre image.
    if (history.epoch, history.index) != seen {
        return Err("The history changed while the operation was running".to_string());
    }
    if replace {
        if let Some(i) = history.index.filter(|&i| i > 0) {
            history.index = Some(i - 1);
        }
    }
    meta.tools = active_tools(&log);
    history.push_logged(next, log);
    // Plusieurs onglets ouverts : chacun a une part du budget mémoire, pas 1 Gio chacun.
    let tabs = map.len();
    let history = map.get_mut(tab_id).ok_or("Tab not found")?;
    history.trim_to(crate::imgz::tab_budget(tabs));
    meta.can_undo = history.can_undo();
    meta.can_redo = history.can_redo();
    meta.history_len = history.entries.len();
    meta.history_index = history.index.unwrap_or(0);
    meta.preview = history.image_url(tab_id);
    Ok(meta)
}

/// Résultat de [`reset_tool`].
#[derive(Serialize)]
pub struct ToolReset {
    pub meta: ImageMeta,
    /// Opérations postérieures qui n'ont pas pu être rejouées (ex. un recadrage devenu hors
    /// de l'image) et ont donc été abandonnées.
    pub dropped: usize,
}

/// Retire de l'état courant toutes les opérations d'un outil et rejoue les autres, à partir de
/// l'image d'origine. Le résultat est une nouvelle étape : on peut l'annuler.
pub fn reset_tool(state: &AppState, tab_id: &str, tool: Tool) -> Result<ToolReset, String> {
    let (base, log, format, seen) = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        let history = map.get(tab_id).ok_or("Tab not found")?;
        history.index.ok_or("No image loaded")?;
        (
            Arc::clone(&history.entries[0]),
            history.current_log(),
            history.format.clone(),
            (history.epoch, history.index),
        )
    };
    if !log.iter().any(|s| s.tool() == Some(tool)) {
        return Ok(ToolReset {
            meta: snapshot(state, tab_id)?.meta()?,
            dropped: 0,
        });
    }

    let mut image = (*base).clone();
    let mut replayed = Vec::with_capacity(log.len());
    let mut dropped = 0;
    // Une fois un outil retiré, l'image n'a plus la géométrie que les étapes suivantes ont vue :
    // celles qui portent des coordonnées ou des dimensions absolues (recadrage, redimensionnement,
    // canevas, gomme) tomberaient au mauvais endroit ou déformeraient l'image. On les abandonne
    // (elles sont comptées dans `dropped`) ; les réglages, rotations et retournements, relatifs,
    // sont rejoués.
    let mut geometry_changed = false;
    for step in log.iter() {
        if step.tool() == Some(tool) {
            geometry_changed = true;
            continue;
        }
        let absolute = matches!(
            step,
            Step::Crop { .. } | Step::Resize { .. } | Step::CanvasResize { .. } | Step::Inpaint(_)
        );
        if geometry_changed && absolute {
            dropped += 1;
            continue;
        }
        match step.apply(&image) {
            Ok(next) => {
                image = next;
                replayed.push(step.clone());
            }
            Err(_) => dropped += 1,
        }
    }
    let meta = commit(
        state,
        tab_id,
        &format,
        image,
        Arc::new(replayed),
        false,
        seen,
    )?;
    Ok(ToolReset { meta, dropped })
}

/// Déplace le curseur de l'historique (annuler, rétablir, revenir à l'original) puis
/// renvoie les métadonnées de l'état atteint, aperçu encodé hors verrou.
pub fn navigate<F>(state: &AppState, tab_id: &str, step: F) -> Result<ImageMeta, String>
where
    F: FnOnce(&mut AppHistory) -> Result<(), String>,
{
    let snap = {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        let history = map.get_mut(tab_id).ok_or("Tab not found")?;
        step(history)?;
        Snapshot::of(tab_id, history)?
    };
    snap.meta()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imgz::test_support::{solid, Harness, TAB};

    #[test]
    fn a_failing_op_leaves_the_history_untouched() {
        let h = Harness::with_image(solid(4, 4, [1, 2, 3]));

        let err = apply_op(&h.state(), TAB, |_| Err("boom".to_string())).unwrap_err();

        assert_eq!(err, "boom");
        assert_eq!(h.history_len(), 1);
    }

    #[test]
    fn a_successful_op_reports_the_new_history_position() {
        let h = Harness::with_image(solid(4, 4, [1, 2, 3]));

        let meta = apply_op(&h.state(), TAB, |img| Ok(img.fliph())).unwrap();

        assert_eq!((meta.history_len, meta.history_index), (2, 1));
        assert!(meta.can_undo && !meta.can_redo);
        assert_eq!(meta.format, "png");
    }

    #[test]
    fn replacing_restarts_from_the_previous_image_and_keeps_one_step() {
        let h = Harness::with_image(solid(4, 4, [10, 10, 10]));
        let brighter = |v: u8| {
            move |img: &DynamicImage| {
                let mut rgba = img.to_rgba8();
                for p in rgba.pixels_mut() {
                    p[0] = p[0].saturating_add(v);
                }
                Ok(DynamicImage::ImageRgba8(rgba))
            }
        };
        apply_op_with(&h.state(), TAB, false, brighter(20)).unwrap();
        assert_eq!(h.pixel(0, 0)[0], 30);

        let meta = apply_op_with(&h.state(), TAB, true, brighter(50)).unwrap();

        // 10 (original) + 50, et non 30 + 50 : l'effet précédent est remplacé.
        assert_eq!(h.pixel(0, 0)[0], 60);
        assert_eq!((meta.history_len, meta.history_index), (2, 1));
    }

    #[test]
    fn replacing_on_the_original_just_pushes() {
        let h = Harness::with_image(solid(4, 4, [10, 10, 10]));

        let meta = apply_op_with(&h.state(), TAB, true, |img| Ok(img.fliph())).unwrap();

        assert_eq!((meta.history_len, meta.history_index), (2, 1));
    }

    #[test]
    fn the_format_of_the_source_survives_edits() {
        let mut history = AppHistory::new();
        history.format = "jpeg".to_string();
        history.open(solid(4, 4, [1, 2, 3]));
        let h = Harness::with_history(history);

        let meta = apply_op(&h.state(), TAB, |img| Ok(img.flipv())).unwrap();

        assert_eq!(meta.format, "jpeg");
    }

    #[test]
    fn the_lock_is_not_held_while_the_op_runs() {
        // Si le verrou était tenu pendant le calcul, ce second accès bloquerait à jamais.
        let h = Harness::with_image(solid(4, 4, [1, 2, 3]));

        apply_op(&h.state(), TAB, |img| {
            assert!(h.state().0.try_lock().is_ok());
            Ok(img.clone())
        })
        .unwrap();
    }

    #[test]
    fn navigating_reports_flags_for_the_reached_state() {
        let h = Harness::with_image(solid(4, 4, [1, 2, 3]));
        apply_op(&h.state(), TAB, |img| Ok(img.fliph())).unwrap();

        let meta = navigate(&h.state(), TAB, |hist| {
            hist.undo();
            Ok(())
        })
        .unwrap();

        assert_eq!((meta.history_len, meta.history_index), (2, 0));
        assert!(!meta.can_undo && meta.can_redo);
    }

    // ── réinitialisation d'un seul outil ─────────────────────────────────────

    fn crop(x: u32, y: u32, width: u32, height: u32) -> Step {
        Step::Crop {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn resetting_the_crop_keeps_the_rotation_made_after_it() {
        let h = Harness::with_image(solid(40, 20, [9, 9, 9]));
        apply_step(&h.state(), TAB, false, crop(0, 0, 10, 10)).unwrap();
        apply_step(&h.state(), TAB, false, Step::Rotate { degrees: 90.0 }).unwrap();

        let reset = reset_tool(&h.state(), TAB, Tool::Crop).unwrap();

        // 40×20 d'origine, tourné de 90° : 20×40. Le recadrage 10×10 a disparu.
        assert_eq!((reset.meta.width, reset.meta.height), (20, 40));
        assert_eq!(reset.dropped, 0);
        assert_eq!(reset.meta.tools, vec!["rotate".to_string()]);
    }

    #[test]
    fn resetting_a_tool_is_a_new_undoable_step() {
        let h = Harness::with_image(solid(40, 20, [9, 9, 9]));
        apply_step(&h.state(), TAB, false, crop(0, 0, 10, 10)).unwrap();
        let before = h.history_len();

        let reset = reset_tool(&h.state(), TAB, Tool::Crop).unwrap();

        assert_eq!(h.history_len(), before + 1);
        assert!(reset.meta.can_undo);
        assert_eq!((reset.meta.width, reset.meta.height), (40, 20));
        assert!(reset.meta.tools.is_empty());
    }

    #[test]
    fn resetting_a_tool_that_was_not_used_changes_nothing() {
        let h = Harness::with_image(solid(40, 20, [9, 9, 9]));
        apply_step(&h.state(), TAB, false, Step::Rotate { degrees: 90.0 }).unwrap();
        let before = h.history_len();

        let reset = reset_tool(&h.state(), TAB, Tool::Crop).unwrap();

        assert_eq!(h.history_len(), before);
        assert_eq!((reset.meta.width, reset.meta.height), (20, 40));
    }

    #[test]
    fn a_later_step_that_no_longer_fits_is_dropped_and_counted() {
        let h = Harness::with_image(solid(20, 20, [9, 9, 9]));
        apply_step(
            &h.state(),
            TAB,
            false,
            Step::Resize {
                width: 10,
                height: 10,
            },
        )
        .unwrap();
        // Valide sur 10×10 ; sur l'original 20×20, ce canevas serait plus petit que l'image.
        let grow = Step::CanvasResize {
            width: 15,
            height: 15,
            anchor: "center".to_string(),
            fill: [0, 0, 0, 0],
        };
        apply_step(&h.state(), TAB, false, grow).unwrap();

        let reset = reset_tool(&h.state(), TAB, Tool::Resize).unwrap();

        assert_eq!(reset.dropped, 1);
        assert_eq!((reset.meta.width, reset.meta.height), (20, 20));
        assert!(reset.meta.tools.is_empty());
    }

    #[test]
    fn a_resize_made_after_a_crop_is_not_replayed_on_the_uncropped_image() {
        // Recadrage 10×10 puis redimensionnement 5×5 : sans le recadrage, ce 5×5 écraserait
        // toute l'image 40×20 dans un carré.
        let h = Harness::with_image(solid(40, 20, [9, 9, 9]));
        apply_step(&h.state(), TAB, false, crop(0, 0, 10, 10)).unwrap();
        apply_step(
            &h.state(),
            TAB,
            false,
            Step::Resize {
                width: 5,
                height: 5,
            },
        )
        .unwrap();

        let reset = reset_tool(&h.state(), TAB, Tool::Crop).unwrap();

        assert_eq!(reset.dropped, 1);
        assert_eq!((reset.meta.width, reset.meta.height), (40, 20));
    }

    #[test]
    fn a_later_crop_is_dropped_when_an_earlier_resize_is_reset() {
        let h = Harness::with_image(solid(40, 20, [9, 9, 9]));
        apply_step(
            &h.state(),
            TAB,
            false,
            Step::Resize {
                width: 20,
                height: 10,
            },
        )
        .unwrap();
        apply_step(&h.state(), TAB, false, crop(0, 0, 10, 10)).unwrap();

        let reset = reset_tool(&h.state(), TAB, Tool::Resize).unwrap();

        // Ces coordonnées valaient pour 20×10 : sur 40×20 elles recadreraient une autre zone.
        assert_eq!(reset.dropped, 1);
        assert_eq!((reset.meta.width, reset.meta.height), (40, 20));
    }

    #[test]
    fn an_undo_during_the_computation_refuses_the_late_result() {
        let h = Harness::with_image(solid(4, 4, [1, 2, 3]));
        apply_op(&h.state(), TAB, |img| Ok(img.fliph())).unwrap();
        let state = h.state();

        // L'opération (lente) est en cours quand l'utilisateur annule.
        let late = apply_op(&state, TAB, |img| {
            state
                .0
                .lock()
                .unwrap()
                .get_mut(TAB)
                .unwrap()
                .undo()
                .expect("une étape à annuler");
            Ok(img.flipv())
        });

        assert!(late.is_err(), "le résultat tardif ne doit pas être empilé");
        assert_eq!(h.history_len(), 2);
        let index = state.0.lock().unwrap().get(TAB).unwrap().index;
        assert_eq!(index, Some(0), "l'annulation reste en vigueur");
    }

    #[test]
    fn replacing_the_last_step_replaces_it_in_the_log_too() {
        let h = Harness::with_image(solid(40, 20, [9, 9, 9]));
        apply_step(&h.state(), TAB, false, Step::Rotate { degrees: 30.0 }).unwrap();
        apply_step(&h.state(), TAB, true, Step::Rotate { degrees: 45.0 }).unwrap();

        let state = h.state();
        let map = state.0.lock().unwrap();
        let log = map.get(TAB).unwrap().current_log();

        assert_eq!(log.len(), 1);
        assert!(matches!(log[0], Step::Rotate { degrees } if degrees == 45.0));
    }
}

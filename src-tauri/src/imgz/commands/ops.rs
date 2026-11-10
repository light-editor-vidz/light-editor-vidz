//! Squelette commun des commandes qui modifient l'image d'un onglet.
//!
//! Le verrou global n'est tenu que le temps de lire ou d'écrire l'historique : le calcul
//! et l'encodage de l'aperçu (plusieurs secondes sur une grande photo) se font hors verrou,
//! si bien qu'une opération longue ne bloque ni les autres onglets ni l'annulation.
//! L'aperçu est encodé **avant** l'empilement : une erreur d'encodage ne laisse donc jamais
//! dans l'historique une étape que l'interface n'a pas reçue.

use image::DynamicImage;
use std::sync::Arc;

use super::open::{build_meta_with, ImageMeta};
use super::steps::{active_tools, Step, Tool};
use crate::imgz::{AppHistory, AppState};
use serde::Serialize;

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
        let mut meta = build_meta_with(
            &self.image,
            &self.format,
            self.can_undo,
            self.can_redo,
            self.url.clone(),
        )?;
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
    let (source, format, base_log) = {
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
        )
    };
    let next = op(&source)?;
    let mut log = (*base_log).clone();
    log.extend(step);
    commit(state, tab_id, &format, next, Arc::new(log), replace)
}

/// Empile `next` (et son journal) et renvoie ses métadonnées.
fn commit(
    state: &AppState,
    tab_id: &str,
    format: &str,
    next: DynamicImage,
    log: Arc<Vec<Step>>,
    replace: bool,
) -> Result<ImageMeta, String> {
    // Les miniatures d'abord, l'empilement ensuite : en cas d'échec, rien n'a changé.
    let mut meta = build_meta_with(&next, format, false, false, String::new())?;

    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let history = map.get_mut(tab_id).ok_or("Tab not found")?;
    if replace {
        if let Some(i) = history.index.filter(|&i| i > 0) {
            history.index = Some(i - 1);
        }
    }
    meta.tools = active_tools(&log);
    history.push_logged(next, log);
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
    let (base, log, format) = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        let history = map.get(tab_id).ok_or("Tab not found")?;
        history.index.ok_or("No image loaded")?;
        (
            Arc::clone(&history.entries[0]),
            history.current_log(),
            history.format.clone(),
        )
    };
    let kept: Vec<&Step> = log.iter().filter(|s| s.tool() != Some(tool)).collect();
    if kept.len() == log.len() {
        return Ok(ToolReset {
            meta: snapshot(state, tab_id)?.meta()?,
            dropped: 0,
        });
    }

    let mut image = (*base).clone();
    let mut replayed = Vec::with_capacity(kept.len());
    let mut dropped = 0;
    for step in kept {
        match step.apply(&image) {
            Ok(next) => {
                image = next;
                replayed.push(step.clone());
            }
            Err(_) => dropped += 1,
        }
    }
    let meta = commit(state, tab_id, &format, image, Arc::new(replayed), false)?;
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

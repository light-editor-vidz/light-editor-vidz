use tauri::State;

use super::open::ImageMeta;
use super::ops::{navigate, reset_tool as reset_tool_steps, ToolReset};
use super::steps::Tool;
use crate::imgz::AppState;

#[tauri::command(async)]
pub fn undo_image(state: State<'_, AppState>, tab_id: String) -> Result<ImageMeta, String> {
    navigate(&state, &tab_id, |history| {
        if !history.can_undo() {
            return Err("Nothing to undo".to_string());
        }
        history.undo().ok_or("Undo failed")?;
        Ok(())
    })
}

#[tauri::command(async)]
pub fn redo_image(state: State<'_, AppState>, tab_id: String) -> Result<ImageMeta, String> {
    navigate(&state, &tab_id, |history| {
        if !history.can_redo() {
            return Err("Nothing to redo".to_string());
        }
        history.redo().ok_or("Redo failed")?;
        Ok(())
    })
}

/// Se place sur une étape précise de l'historique (clic dans le panneau Historique).
#[tauri::command(async)]
pub fn goto_history(
    state: State<'_, AppState>,
    tab_id: String,
    index: usize,
) -> Result<ImageMeta, String> {
    navigate(&state, &tab_id, |history| {
        if index >= history.entries.len() {
            return Err(format!(
                "History step {index} out of range ({} steps)",
                history.entries.len()
            ));
        }
        history.index = Some(index);
        Ok(())
    })
}

#[tauri::command(async)]
pub fn reset_to_original(state: State<'_, AppState>, tab_id: String) -> Result<ImageMeta, String> {
    navigate(&state, &tab_id, |history| {
        if history.entries.is_empty() {
            return Err("No history".to_string());
        }
        history.index = Some(0);
        Ok(())
    })
}

/// Réinitialise un seul outil (`crop`, `rotate`, `flip`, `resize`, `canvas`) : ses opérations
/// sont retirées, les autres rejouées depuis l'original.
#[tauri::command(async)]
pub fn reset_tool(
    state: State<'_, AppState>,
    tab_id: String,
    tool: String,
) -> Result<ToolReset, String> {
    let tool = Tool::parse(&tool).ok_or_else(|| format!("Unknown tool: {tool}"))?;
    reset_tool_steps(&state, &tab_id, tool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imgz::test_support::{solid, Harness, TAB};
    use crate::imgz::AppHistory;

    /// Historique à trois états : 4×4, puis 5×5, puis 6×6.
    fn three_steps() -> Harness {
        let mut h = AppHistory::new();
        h.open(solid(4, 4, [1, 1, 1]));
        h.push(solid(5, 5, [2, 2, 2]));
        h.push(solid(6, 6, [3, 3, 3]));
        Harness::with_history(h)
    }

    #[test]
    fn undo_steps_back_one_entry() {
        let h = three_steps();

        let meta = undo_image(h.state(), TAB.into()).unwrap();

        assert_eq!(meta.width, 5);
        assert!(meta.can_undo);
        assert!(meta.can_redo);
    }

    #[test]
    fn undo_stops_at_the_first_entry() {
        let h = three_steps();

        undo_image(h.state(), TAB.into()).unwrap();
        let meta = undo_image(h.state(), TAB.into()).unwrap();

        assert_eq!(meta.width, 4);
        assert!(!meta.can_undo);
        assert_eq!(
            undo_image(h.state(), TAB.into()).unwrap_err(),
            "Nothing to undo"
        );
    }

    #[test]
    fn redo_steps_forward_again() {
        let h = three_steps();
        undo_image(h.state(), TAB.into()).unwrap();

        let meta = redo_image(h.state(), TAB.into()).unwrap();

        assert_eq!(meta.width, 6);
        assert!(!meta.can_redo);
    }

    #[test]
    fn redo_needs_something_to_replay() {
        let h = three_steps();

        assert_eq!(
            redo_image(h.state(), TAB.into()).unwrap_err(),
            "Nothing to redo"
        );
    }

    #[test]
    fn reset_jumps_back_to_the_opened_image() {
        let h = three_steps();

        let meta = reset_to_original(h.state(), TAB.into()).unwrap();

        assert_eq!(meta.width, 4);
        assert!(!meta.can_undo);
        assert!(meta.can_redo); // les étapes suivantes restent rejouables
    }

    #[test]
    fn reset_needs_a_non_empty_history() {
        assert_eq!(
            reset_to_original(Harness::without_image().state(), TAB.into()).unwrap_err(),
            "No history"
        );
    }

    #[test]
    fn every_history_command_rejects_an_unknown_tab() {
        let h = Harness::empty();

        for err in [
            undo_image(h.state(), TAB.into()).unwrap_err(),
            redo_image(h.state(), TAB.into()).unwrap_err(),
            reset_to_original(h.state(), TAB.into()).unwrap_err(),
        ] {
            assert_eq!(err, "Tab not found");
        }
    }

    #[test]
    fn goto_jumps_to_any_step_both_ways() {
        let h = three_steps();

        let back = goto_history(h.state(), TAB.into(), 0).unwrap();
        assert_eq!((back.width, back.history_index), (4, 0));
        assert!(!back.can_undo && back.can_redo);

        let forward = goto_history(h.state(), TAB.into(), 2).unwrap();
        assert_eq!((forward.width, forward.history_index), (6, 2));
        assert!(forward.can_undo && !forward.can_redo);
    }

    #[test]
    fn goto_rejects_a_step_that_does_not_exist() {
        let h = three_steps();

        let err = goto_history(h.state(), TAB.into(), 3).unwrap_err();

        assert!(err.contains("out of range"), "{err}");
        assert_eq!(h.current().width(), 6, "la position n'a pas bougé");
    }

    #[test]
    fn goto_rejects_an_unknown_tab() {
        assert_eq!(
            goto_history(Harness::empty().state(), TAB.into(), 0).unwrap_err(),
            "Tab not found"
        );
    }
}

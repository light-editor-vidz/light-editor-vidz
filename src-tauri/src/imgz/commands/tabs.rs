use tauri::State;

use crate::imgz::AppState;

#[tauri::command]
pub fn close_tab(state: State<'_, AppState>, tab_id: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.remove(&tab_id);
    Ok(())
}

#[tauri::command]
pub fn close_all_tabs(state: State<'_, AppState>) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.clear();
    Ok(())
}

#[tauri::command]
pub fn close_other_tabs(state: State<'_, AppState>, tab_id: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.retain(|k, _| k == &tab_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imgz::test_support::{solid, Harness};
    use crate::imgz::AppHistory;
    use std::collections::HashMap;

    fn three_tabs() -> Harness {
        let mut map = HashMap::new();
        for id in ["a", "b", "c"] {
            let mut h = AppHistory::new();
            h.open(solid(2, 2, [1, 1, 1]));
            map.insert(id.to_string(), h);
        }
        Harness::with_map(map)
    }

    fn ids(h: &Harness) -> Vec<String> {
        let state = h.state();
        let map = state.0.lock().unwrap();
        let mut keys: Vec<String> = map.keys().cloned().collect();
        keys.sort();
        keys
    }

    #[test]
    fn closing_a_tab_drops_only_that_one() {
        let h = three_tabs();

        close_tab(h.state(), "b".into()).unwrap();

        assert_eq!(ids(&h), ["a", "c"]);
    }

    #[test]
    fn closing_an_unknown_tab_is_a_no_op() {
        let h = three_tabs();

        close_tab(h.state(), "zzz".into()).unwrap();

        assert_eq!(ids(&h).len(), 3);
    }

    #[test]
    fn closing_all_empties_the_state() {
        let h = three_tabs();

        close_all_tabs(h.state()).unwrap();

        assert!(ids(&h).is_empty());
    }

    #[test]
    fn closing_the_others_keeps_the_named_tab() {
        let h = three_tabs();

        close_other_tabs(h.state(), "b".into()).unwrap();

        assert_eq!(ids(&h), ["b"]);
    }

    #[test]
    fn closing_the_others_of_an_unknown_tab_clears_everything() {
        let h = three_tabs();

        close_other_tabs(h.state(), "zzz".into()).unwrap();

        assert!(ids(&h).is_empty());
    }
}

//! Journal des opérations d'un onglet.
//!
//! L'historique garde une image par étape, mais aussi, pour chacune, la liste des opérations
//! qui l'ont produite à partir de l'original. C'est ce qui permet de **réinitialiser un seul
//! outil** : on retire ses opérations de la liste et on rejoue les autres sur l'original.

use image::DynamicImage;
use std::sync::Arc;

use super::inpaint::{inpaint_dynamic, MaskBox};
use super::pipeline::Op;
use super::transform;

/// Les outils de géométrie, qui ont chacun leur bouton « Réinitialiser ».
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Crop,
    Rotate,
    Flip,
    Resize,
    Canvas,
}

pub const TOOLS: [Tool; 5] = [
    Tool::Crop,
    Tool::Rotate,
    Tool::Flip,
    Tool::Resize,
    Tool::Canvas,
];

impl Tool {
    pub fn name(self) -> &'static str {
        match self {
            Tool::Crop => "crop",
            Tool::Rotate => "rotate",
            Tool::Flip => "flip",
            Tool::Resize => "resize",
            Tool::Canvas => "canvas",
        }
    }

    pub fn parse(name: &str) -> Option<Tool> {
        TOOLS.into_iter().find(|t| t.name() == name)
    }
}

#[derive(Debug, Clone)]
pub enum Step {
    Crop {
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    },
    CanvasResize {
        width: u32,
        height: u32,
        anchor: String,
        fill: [u8; 4],
    },
    Resize {
        width: u32,
        height: u32,
    },
    Flip {
        direction: String,
    },
    Rotate {
        degrees: f64,
    },
    /// Ajustement ou filtre.
    Adjust(Op),
    Inpaint(Arc<MaskBox>),
}

impl Step {
    /// L'outil de géométrie dont relève l'étape, `None` pour les réglages, filtres et retouches.
    pub fn tool(&self) -> Option<Tool> {
        match self {
            Step::Crop { .. } => Some(Tool::Crop),
            Step::Rotate { .. } => Some(Tool::Rotate),
            Step::Flip { .. } => Some(Tool::Flip),
            Step::Resize { .. } => Some(Tool::Resize),
            Step::CanvasResize { .. } => Some(Tool::Canvas),
            Step::Adjust(_) | Step::Inpaint(_) => None,
        }
    }

    pub fn apply(&self, img: &DynamicImage) -> Result<DynamicImage, String> {
        match self {
            Step::Crop {
                x,
                y,
                width,
                height,
            } => transform::crop_dynamic(img, *x, *y, *width, *height),
            Step::CanvasResize {
                width,
                height,
                anchor,
                fill,
            } => transform::canvas_resize_dynamic(img, *width, *height, anchor, *fill),
            Step::Resize { width, height } => transform::resize_dynamic(img, *width, *height),
            Step::Flip { direction } => transform::flip_dynamic(img, direction),
            Step::Rotate { degrees } => transform::rotate_dynamic(img, *degrees),
            Step::Adjust(op) => op.apply(img),
            Step::Inpaint(mask) => inpaint_dynamic(img, mask),
        }
    }
}

/// Noms des outils de géométrie présents dans un journal.
pub fn active_tools(log: &[Step]) -> Vec<String> {
    TOOLS
        .into_iter()
        .filter(|t| log.iter().any(|s| s.tool() == Some(*t)))
        .map(|t| t.name().to_string())
        .collect()
}

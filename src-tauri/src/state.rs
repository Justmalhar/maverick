use std::sync::Arc;

use crate::bootstrap::MaverickPaths;
use crate::sidecar::Sidecar;

pub struct AppState {
    pub sidecar: Arc<Sidecar>,
    pub paths: MaverickPaths,
}

impl AppState {
    pub fn new(sidecar: Arc<Sidecar>, paths: MaverickPaths) -> Self {
        Self { sidecar, paths }
    }
}

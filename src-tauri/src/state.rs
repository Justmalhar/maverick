use std::sync::Arc;

use crate::sidecar::Sidecar;

pub struct AppState {
    pub sidecar: Arc<Sidecar>,
}

impl AppState {
    pub fn new(sidecar: Arc<Sidecar>) -> Self {
        Self { sidecar }
    }
}

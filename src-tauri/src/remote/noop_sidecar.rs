//! A `SidecarRequest` that serves no methods — for the headless daemon in M0,
//! which supports terminals + pairing but not the sidecar-backed file/git/agent
//! helpers. Every request returns a descriptive error rather than hanging.

use async_trait::async_trait;
use serde_json::Value;

use crate::remote::bridge::SidecarRequest;

pub struct NoopSidecar;

#[async_trait]
impl SidecarRequest for NoopSidecar {
    async fn request(&self, method: &str, _params: Value) -> Result<Value, String> {
        Err(format!("sidecar unavailable in headless daemon: {method}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn request_returns_unavailable_error() {
        let s = NoopSidecar;
        let err = s.request("file.tree", Value::Null).await.unwrap_err();
        assert!(err.contains("file.tree"));
        assert!(err.contains("headless"));
    }
}

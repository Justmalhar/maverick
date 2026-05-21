use maverick_lib::sidecar::{jsonrpc_event_name, parse_message, SidecarMessage};
use serde_json::json;

#[test]
fn parses_response_with_numeric_id() {
    let line = r#"{"jsonrpc":"2.0","id":7,"result":{"ok":true}}"#;
    match parse_message(line).expect("response should parse") {
        SidecarMessage::Response { id, result, error } => {
            assert_eq!(id, 7);
            assert_eq!(result.unwrap(), json!({ "ok": true }));
            assert!(error.is_none());
        }
        _ => panic!("expected Response variant"),
    }
}

#[test]
fn parses_response_with_string_id() {
    let line = r#"{"jsonrpc":"2.0","id":"42","result":null}"#;
    let msg = parse_message(line).expect("should parse string id");
    match msg {
        SidecarMessage::Response { id, .. } => assert_eq!(id, 42),
        _ => panic!("expected Response"),
    }
}

#[test]
fn parses_rpc_error() {
    let line =
        r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"method not found"}}"#;
    match parse_message(line).expect("error response should parse") {
        SidecarMessage::Response { id, result, error } => {
            assert_eq!(id, 3);
            assert!(result.is_none());
            let (code, message) = error.expect("error payload present");
            assert_eq!(code, -32601);
            assert_eq!(message, "method not found");
        }
        _ => panic!("expected Response variant"),
    }
}

#[test]
fn parses_notification() {
    let line = r#"{"jsonrpc":"2.0","method":"pty.data","params":{"ptyId":"pty_1","data":"hello"}}"#;
    match parse_message(line).expect("notification should parse") {
        SidecarMessage::Notification { method, params } => {
            assert_eq!(method, "pty.data");
            assert_eq!(
                params,
                json!({ "ptyId": "pty_1", "data": "hello" })
            );
        }
        _ => panic!("expected Notification variant"),
    }
}

#[test]
fn dotted_methods_become_colon_events() {
    assert_eq!(jsonrpc_event_name("pty.data"), "pty:data");
    assert_eq!(jsonrpc_event_name("workspace.status"), "workspace:status");
}

#[test]
fn rejects_garbage_lines() {
    assert!(parse_message("not json").is_err());
    assert!(parse_message(r#"{"jsonrpc":"2.0"}"#).is_err());
}

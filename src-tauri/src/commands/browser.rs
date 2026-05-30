use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl};

const BROWSER_LABEL: &str = "maverick-browser";

// Injected before each page load. Exposes window.__mvInspect.{enable,disable}()
// which the host toggles via eval; on click it computes a CSS path and emits a
// `browser://captured` Tauri event back to the main window.
const INSPECT_SCRIPT: &str = r#"
(function () {
  if (window.__mvInspect) return;
  var hl = null;
  function ensureHighlight() {
    if (hl) return hl;
    hl = document.createElement('div');
    hl.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #7c5cff;background:rgba(124,92,255,0.15);';
    document.documentElement.appendChild(hl);
    return hl;
  }
  function cssPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && parts.length < 6) {
      var part = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(part + '#' + el.id); break; }
      if (el.className && typeof el.className === 'string') {
        part += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
      }
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  function emit(payload) {
    try {
      window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
        event: 'browser://captured',
        payload: payload,
      });
    } catch (e) { /* host not ready */ }
  }
  function onMove(e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    var r = t.getBoundingClientRect();
    var h = ensureHighlight();
    h.style.top = r.top + 'px';
    h.style.left = r.left + 'px';
    h.style.width = r.width + 'px';
    h.style.height = r.height + 'px';
    h.style.display = 'block';
  }
  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var t = e.target;
    if (!(t instanceof Element)) return;
    emit({
      selector: cssPath(t),
      text: (t.innerText || '').slice(0, 240),
      html: (t.outerHTML || '').slice(0, 2000),
    });
  }
  window.__mvInspect = {
    enable: function () {
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
    },
    disable: function () {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      if (hl) hl.style.display = 'none';
    },
  };
})();
"#;

fn parse_url(url: &str) -> Result<WebviewUrl, String> {
    tauri::Url::parse(url)
        .map(WebviewUrl::External)
        .map_err(|e| format!("invalid url: {e}"))
}

#[tauri::command]
pub async fn browser_open<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let position = LogicalPosition::new(x, y);
    let size = LogicalSize::new(width, height);

    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview
            .navigate(tauri::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?)
            .map_err(|e| e.to_string())?;
        webview.set_position(position).map_err(|e| e.to_string())?;
        webview.set_size(size).map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let builder = WebviewBuilder::new(BROWSER_LABEL, parse_url(&url)?)
        .initialization_script(INSPECT_SCRIPT);
    window
        .add_child(builder, position, size)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    let webview = app
        .get_webview(BROWSER_LABEL)
        .ok_or_else(|| "browser webview not open".to_string())?;
    webview
        .navigate(tauri::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_set_bounds<R: Runtime>(
    app: AppHandle<R>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = match app.get_webview(BROWSER_LABEL) {
        Some(w) => w,
        None => return Ok(()),
    };
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_show<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_close<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_eval<R: Runtime>(app: AppHandle<R>, script: String) -> Result<(), String> {
    let webview = app
        .get_webview(BROWSER_LABEL)
        .ok_or_else(|| "browser webview not open".to_string())?;
    webview.eval(&script).map_err(|e| e.to_string())
}

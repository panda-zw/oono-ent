import SwiftUI
import WebKit
import os

private let webLog = Logger(subsystem: "com.panashemapika.oono-ent", category: "webview")

struct WebViewContainer: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            webLog.error("didFail \(error.localizedDescription, privacy: .public)")
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            webLog.error("didFailProvisional \(error.localizedDescription, privacy: .public)")
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if let s = message.body as? String {
                webLog.info("[console] \(s, privacy: .public)")
            }
        }
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Inline playback + autoplay so the persistent player and radio work
        // without forcing fullscreen. `allowsPictureInPictureMediaPlayback`
        // is what lets iOS auto-PiP an active <video> when the user swipes
        // the app to background; combined with AVAudioSession `.playback`
        // (see AudioSessionManager) audio continues too.
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.allowsAirPlayForMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.suppressesIncrementalRendering = false

        // Persist localStorage/IndexedDB so watchlist + continue-watching
        // survive between launches. The default data store is already
        // persistent, but we set it explicitly to make intent obvious.
        config.websiteDataStore = .default()

        // Register the HLS proxy scheme. The webview JS uses
        // `oono-hls://stream?u=…&r=…&ua=…` URLs anywhere a proxied stream
        // is needed; the handler injects headers and rewrites manifests.
        let hls = HLSProxyHandler()
        config.setURLSchemeHandler(hls, forURLScheme: "oono-hls")

        // Bridge JS console output into the unified OS log so we can debug
        // the bundled React app from `xcrun simctl spawn booted log show`.
        let bridgeScript = WKUserScript(
            source: """
            (function(){
              var post = function(msg){
                try { window.webkit.messageHandlers.console.postMessage(String(msg)); } catch(_){}
              };
              var bridge = function(level){
                return function(){
                  var args = [];
                  for (var i=0;i<arguments.length;i++){
                    var a = arguments[i];
                    try { args.push(typeof a === 'string' ? a : JSON.stringify(a)); } catch(_){ args.push(String(a)); }
                  }
                  post('['+level+'] '+args.join(' '));
                };
              };
              ['log','warn','error','info'].forEach(function(l){
                var orig = console[l];
                console[l] = function(){ bridge(l).apply(null, arguments); if(orig) orig.apply(console, arguments); };
              });
              window.addEventListener('error', function(e){
                post('[uncaught] '+e.message+' @ '+(e.filename||'?')+':'+(e.lineno||'?')+':'+(e.colno||'?'));
              });
              window.addEventListener('unhandledrejection', function(e){
                post('[rejection] '+((e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)));
              });
              post('[init] bridge installed @ '+location.href);
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(bridgeScript)
        config.userContentController.add(context.coordinator, name: "console")

        // Auto-PiP injector — runs in EVERY frame (including the
        // cross-origin VidSrc / 2Embed / VidLink iframes) and tags any
        // <video> element with the attributes iOS needs to auto-PiP the
        // app on background. Without this, swiping home from a movie just
        // pauses playback because the embed provider's <video> doesn't
        // ship `autopictureinpicture` itself.
        let pipScript = WKUserScript(
            source: """
            (function(){
              function tag(v){
                if (!v || v.__oonoPip) return;
                v.__oonoPip = true;
                try {
                  v.setAttribute('autopictureinpicture','');
                  v.setAttribute('playsinline','');
                  v.setAttribute('webkit-playsinline','');
                  v.setAttribute('x-webkit-airplay','allow');
                  v.disablePictureInPicture = false;
                } catch(_) {}
              }
              function scan(root){
                try {
                  (root.querySelectorAll ? root.querySelectorAll('video') : [])
                    .forEach(tag);
                } catch(_) {}
              }
              scan(document);
              try {
                var mo = new MutationObserver(function(ms){
                  for (var i=0;i<ms.length;i++){
                    var n = ms[i].addedNodes;
                    for (var j=0;j<n.length;j++){
                      var el = n[j];
                      if (!el || el.nodeType !== 1) continue;
                      if (el.tagName === 'VIDEO') tag(el);
                      else scan(el);
                    }
                  }
                });
                mo.observe(document.documentElement || document, { childList:true, subtree:true });
              } catch(_) {}
              // When the page hides (app backgrounded), nudge the active
              // <video> into PiP. iOS auto-PiP needs the attribute we set
              // above, but some embed players also need this explicit
              // request to actually pop the floating window.
              document.addEventListener('visibilitychange', function(){
                if (document.visibilityState !== 'hidden') return;
                var vids = document.querySelectorAll('video');
                for (var i=0;i<vids.length;i++){
                  var v = vids[i];
                  if (v.paused || v.ended) continue;
                  if (typeof v.requestPictureInPicture === 'function') {
                    v.requestPictureInPicture().catch(function(){});
                    break;
                  }
                }
              });
            })();
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(pipScript)

        // Host the React build under an `oono-app://` scheme so modules
        // get a real (non-opaque) origin — type="module" scripts won't load
        // from file:// once Vite stamps a crossorigin attribute on them.
        let appHandler = AppBundleHandler()
        config.setURLSchemeHandler(appHandler, forURLScheme: "oono-app")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }

        loadBundledApp(into: webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    private func loadBundledApp(into webView: WKWebView) {
        let webDir = Bundle.main.bundleURL.appendingPathComponent("Web", isDirectory: true)
        let indexURL = webDir.appendingPathComponent("index.html")
        if FileManager.default.fileExists(atPath: indexURL.path),
           let request = URL(string: "oono-app://app/index.html").map({ URLRequest(url: $0) }) {
            webView.load(request)
            return
        }
        webView.loadHTMLString(Self.placeholderHTML, baseURL: nil)
    }

    private static let placeholderHTML = """
    <!DOCTYPE html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
    <style>
    html,body{margin:0;height:100%;background:#000;color:#fff;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}
    .card{max-width:480px;padding:32px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.04)}
    h1{font-size:18px;margin:0 0 8px 0}
    p{font-size:14px;line-height:1.5;opacity:.7;margin:0}
    code{background:rgba(255,255,255,.1);padding:2px 6px;border-radius:4px;font-size:12px}
    </style></head><body><div class="card">
    <h1>Web bundle not found</h1>
    <p>Run <code>pnpm build:ios</code> from the repo root, then rebuild this Xcode target. The React app will be bundled into <code>OonoEnt/Web/</code>.</p>
    </div></body></html>
    """
}

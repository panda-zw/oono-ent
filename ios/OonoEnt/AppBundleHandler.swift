import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the bundled Vite-built React app under the `oono-app://` scheme.
///
/// We can't load the bundle via `file://` because Vite emits a
/// `crossorigin` attribute on the entry module script. The `file://` origin
/// is opaque, so the cross-origin import gets rejected. A custom WKWebView
/// scheme gives the loader a real, same-document origin and modules
/// resolve without complaint.
///
/// The host portion of the URL is ignored; the path is resolved relative
/// to `<bundle>/Web/`.
final class AppBundleHandler: NSObject, WKURLSchemeHandler {
    private let webDir: URL = Bundle.main.bundleURL.appendingPathComponent("Web", isDirectory: true)

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "OonoApp", code: 400))
            return
        }
        var relative = url.path
        if relative.hasPrefix("/") { relative.removeFirst() }
        if relative.isEmpty { relative = "index.html" }

        let fileURL = webDir.appendingPathComponent(relative)
        guard FileManager.default.fileExists(atPath: fileURL.path),
              let data = try? Data(contentsOf: fileURL) else {
            let body = "Not found: \(relative)".data(using: .utf8) ?? Data()
            send(task: urlSchemeTask, status: 404, contentType: "text/plain", body: body)
            return
        }
        let contentType = contentType(for: fileURL.pathExtension)
        send(task: urlSchemeTask, status: 200, contentType: contentType, body: data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        // Synchronous reads, nothing to cancel.
    }

    private func send(task: any WKURLSchemeTask, status: Int, contentType: String, body: Data) {
        guard let url = task.request.url else { return }
        let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": contentType,
                "Content-Length": "\(body.count)",
                "Cache-Control": "no-cache",
            ],
        )
        if let response {
            task.didReceive(response)
            task.didReceive(body)
            task.didFinish()
        } else {
            task.didFailWithError(NSError(domain: "OonoApp", code: 500))
        }
    }

    private func contentType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs":   return "application/javascript; charset=utf-8"
        case "css":         return "text/css; charset=utf-8"
        case "json":        return "application/json; charset=utf-8"
        case "svg":         return "image/svg+xml"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif":         return "image/gif"
        case "webp":        return "image/webp"
        case "ico":         return "image/x-icon"
        case "woff":        return "font/woff"
        case "woff2":       return "font/woff2"
        case "ttf":         return "font/ttf"
        case "map":         return "application/json"
        default:
            if let type = UTType(filenameExtension: ext)?.preferredMIMEType { return type }
            return "application/octet-stream"
        }
    }
}

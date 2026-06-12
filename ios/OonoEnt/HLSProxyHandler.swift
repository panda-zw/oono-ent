import Foundation
import WebKit

/// WKURLSchemeHandler that mirrors src-tauri/src/proxy.rs.
///
/// hls.js (or any code in the webview) requests
/// `oono-hls://stream?u=<encoded upstream>&r=<referer>&ua=<user-agent>` and
/// this handler:
///   1. Fetches the upstream URL with the requested Referer / User-Agent.
///   2. If the response is an m3u8 manifest, rewrites every segment / variant
///      line to point back through this scheme so headers persist down the
///      whole playlist tree.
///   3. Streams everything else through verbatim.
///
/// The scheme is registered in `WebViewContainer` via
/// `config.setURLSchemeHandler(_:forURLScheme:)`.
final class HLSProxyHandler: NSObject, WKURLSchemeHandler {
    private let session: URLSession
    private let queue = DispatchQueue(label: "oono.hls.proxy", qos: .userInitiated, attributes: .concurrent)
    private var inflight: [ObjectIdentifier: URLSessionDataTask] = [:]
    private let inflightLock = NSLock()

    override init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpMaximumConnectionsPerHost = 8
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        // We set headers explicitly per request, so suppress URLSession's
        // default UA/Accept headers to avoid surprising upstreams.
        config.httpAdditionalHeaders = [:]
        self.session = URLSession(configuration: config)
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let request = urlSchemeTask.request.url.flatMap(parse) else {
            urlSchemeTask.didFailWithError(NSError(
                domain: "OonoHLS", code: 400,
                userInfo: [NSLocalizedDescriptionKey: "Bad oono-hls:// URL"]
            ))
            return
        }

        var upstream = URLRequest(url: request.target)
        upstream.httpMethod = "GET"
        if let referer = request.referer {
            upstream.setValue(referer, forHTTPHeaderField: "Referer")
        }
        if let ua = request.userAgent {
            upstream.setValue(ua, forHTTPHeaderField: "User-Agent")
        }
        upstream.setValue("*/*", forHTTPHeaderField: "Accept")

        let taskId = ObjectIdentifier(urlSchemeTask)
        let task = session.dataTask(with: upstream) { [weak self] data, response, error in
            guard let self else { return }
            self.complete(taskId: taskId)

            if let error {
                self.fail(urlSchemeTask, error: error)
                return
            }
            guard let http = response as? HTTPURLResponse, let data else {
                self.fail(urlSchemeTask, error: NSError(
                    domain: "OonoHLS", code: 502,
                    userInfo: [NSLocalizedDescriptionKey: "Empty upstream response"]
                ))
                return
            }

            let contentType = (http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream").lowercased()
            let looksLikeManifest = request.target.absoluteString.hasSuffix(".m3u8")
                || contentType.contains("mpegurl")
                || contentType.contains("m3u8")

            if looksLikeManifest {
                let rewritten = self.rewriteManifest(
                    body: data,
                    upstream: request.target,
                    referer: request.referer,
                    userAgent: request.userAgent
                )
                self.send(
                    task: urlSchemeTask,
                    status: http.statusCode,
                    contentType: "application/vnd.apple.mpegurl",
                    body: rewritten.data(using: .utf8) ?? Data()
                )
            } else {
                self.send(
                    task: urlSchemeTask,
                    status: http.statusCode,
                    contentType: http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream",
                    body: data
                )
            }
        }

        inflightLock.lock()
        inflight[taskId] = task
        inflightLock.unlock()
        task.resume()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        let taskId = ObjectIdentifier(urlSchemeTask)
        inflightLock.lock()
        let task = inflight.removeValue(forKey: taskId)
        inflightLock.unlock()
        task?.cancel()
    }

    // MARK: - Helpers

    private struct ProxyRequest {
        let target: URL
        let referer: String?
        let userAgent: String?
    }

    private func parse(_ url: URL) -> ProxyRequest? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else { return nil }
        var u: String?
        var r: String?
        var ua: String?
        for item in queryItems {
            switch item.name {
            case "u": u = item.value
            case "r": r = item.value
            case "ua": ua = item.value
            default: break
            }
        }
        guard let raw = u, let target = URL(string: raw) else { return nil }
        return ProxyRequest(target: target, referer: r, userAgent: ua)
    }

    private func send(task: any WKURLSchemeTask, status: Int, contentType: String, body: Data) {
        guard let url = task.request.url else { return }
        let headers: [String: String] = [
            "Content-Type": contentType,
            "Content-Length": "\(body.count)",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        ]
        if let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) {
            task.didReceive(response)
            task.didReceive(body)
            task.didFinish()
        } else {
            task.didFailWithError(NSError(domain: "OonoHLS", code: 500))
        }
    }

    private func fail(_ task: any WKURLSchemeTask, error: Error) {
        task.didFailWithError(error)
    }

    private func complete(taskId: ObjectIdentifier) {
        inflightLock.lock()
        inflight.removeValue(forKey: taskId)
        inflightLock.unlock()
    }

    private func rewriteManifest(
        body: Data,
        upstream: URL,
        referer: String?,
        userAgent: String?
    ) -> String {
        let text = String(data: body, encoding: .utf8) ?? ""
        var out = ""
        out.reserveCapacity(text.count + 256)

        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : String(rawLine)
            if line.isEmpty || line.hasPrefix("#") {
                out.append(line)
                out.append("\n")
                continue
            }
            let absolute = URL(string: line, relativeTo: upstream)?.absoluteURL.absoluteString ?? line
            var queryItems: [URLQueryItem] = [URLQueryItem(name: "u", value: absolute)]
            if let referer { queryItems.append(URLQueryItem(name: "r", value: referer)) }
            if let userAgent { queryItems.append(URLQueryItem(name: "ua", value: userAgent)) }

            var components = URLComponents()
            components.scheme = "oono-hls"
            components.host = "stream"
            components.queryItems = queryItems
            if let rewritten = components.url?.absoluteString {
                out.append(rewritten)
            } else {
                out.append(line)
            }
            out.append("\n")
        }
        return out
    }
}

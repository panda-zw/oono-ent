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
///   3. Streams everything else through chunk-by-chunk — critical for the
///      infinite radio streams (Zeno.fm, iono.fm) and large HLS segments.
///
/// The scheme is registered in `WebViewContainer` via
/// `config.setURLSchemeHandler(_:forURLScheme:)`.
final class HLSProxyHandler: NSObject, WKURLSchemeHandler {
    private let session: URLSession
    private let delegate: ProxyDelegate

    override init() {
        let config = URLSessionConfiguration.default
        // Default is 4 per host; live IPTV often pulls 6-8 segments in
        // parallel during ABR ramp-up. 12 gives hls.js plenty of room
        // without overloading the upstream CDN.
        config.httpMaximumConnectionsPerHost = 12
        // Keep-alive: reuse the same TCP/TLS connection across segment
        // requests. Without this URLSession sometimes opens a fresh
        // connection per request and each handshake adds ~150 ms.
        config.httpShouldUsePipelining = true
        config.urlCache = nil  // hls.js does its own caching
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = .infinity  // radio streams never finish
        // We set headers explicitly per request, so suppress URLSession's
        // default UA/Accept headers to avoid surprising upstreams.
        config.httpAdditionalHeaders = [:]
        if #available(iOS 16.0, *) {
            // Prefer TLS 1.3 / HTTP/2 wherever the upstream supports it.
            // URLSession picks the strongest protocol both peers offer.
            config.tlsMinimumSupportedProtocolVersion = .TLSv12
        }
        self.delegate = ProxyDelegate()
        self.session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
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

        let task = session.dataTask(with: upstream)
        let isManifest = request.target.absoluteString.hasSuffix(".m3u8")
        delegate.register(
            task: task,
            schemeTask: urlSchemeTask,
            isManifest: isManifest,
            upstream: (target: request.target, referer: request.referer, userAgent: request.userAgent),
        )
        task.resume()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        delegate.cancel(schemeTask: urlSchemeTask)
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
}

/// URLSession delegate that fans out streaming bytes to the matching
/// WKURLSchemeTask. We can't directly forward the chunks from a dataTask
/// completion handler because that buffers the whole body — for infinite
/// radio streams, the completion never fires.
private final class ProxyDelegate: NSObject, URLSessionDataDelegate {
    private struct Entry {
        let schemeTask: any WKURLSchemeTask
        let isManifest: Bool
        let upstream: URL
        let referer: String?
        let userAgent: String?
        // Manifests need to be buffered + rewritten before the body is
        // delivered. For pass-through bodies we deliver chunks live.
        var buffer: Data
        var didSendResponse: Bool
        var cancelled: Bool
    }

    private let queue = DispatchQueue(label: "oono.hls.proxy.delegate")
    private var entries: [Int: Entry] = [:]

    func register(
        task: URLSessionDataTask,
        schemeTask: any WKURLSchemeTask,
        isManifest: Bool,
        upstream: (target: URL, referer: String?, userAgent: String?)
    ) {
        queue.sync {
            entries[task.taskIdentifier] = Entry(
                schemeTask: schemeTask,
                isManifest: isManifest,
                upstream: upstream.target,
                referer: upstream.referer,
                userAgent: upstream.userAgent,
                buffer: Data(),
                didSendResponse: false,
                cancelled: false,
            )
        }
    }

    func cancel(schemeTask: any WKURLSchemeTask) {
        queue.sync {
            for (id, entry) in entries where ObjectIdentifier(entry.schemeTask as AnyObject) == ObjectIdentifier(schemeTask as AnyObject) {
                entries[id]?.cancelled = true
            }
        }
    }

    // MARK: URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        completionHandler(.allow)
        guard let http = response as? HTTPURLResponse else { return }
        queue.sync {
            guard var entry = entries[dataTask.taskIdentifier], !entry.cancelled else { return }
            if entry.isManifest {
                // Defer sending the response until we've rewritten the body.
                return
            }
            let contentType = http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
            let headers: [String: String] = [
                "Content-Type": contentType,
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            ]
            if let rewritten = HTTPURLResponse(
                url: entry.schemeTask.request.url ?? entry.upstream,
                statusCode: http.statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: headers,
            ) {
                entry.schemeTask.didReceive(rewritten)
                entry.didSendResponse = true
                entries[dataTask.taskIdentifier] = entry
            }
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        queue.sync {
            guard var entry = entries[dataTask.taskIdentifier], !entry.cancelled else { return }
            if entry.isManifest {
                entry.buffer.append(data)
                entries[dataTask.taskIdentifier] = entry
                return
            }
            entry.schemeTask.didReceive(data)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        queue.sync {
            guard var entry = entries.removeValue(forKey: task.taskIdentifier) else { return }
            if entry.cancelled { return }
            if let error {
                entry.schemeTask.didFailWithError(error)
                return
            }
            if entry.isManifest {
                let rewritten = rewriteManifest(
                    body: entry.buffer,
                    upstream: entry.upstream,
                    referer: entry.referer,
                    userAgent: entry.userAgent,
                )
                let body = rewritten.data(using: .utf8) ?? Data()
                let headers = [
                    "Content-Type": "application/vnd.apple.mpegurl",
                    "Content-Length": "\(body.count)",
                    "Cache-Control": "no-cache",
                    "Access-Control-Allow-Origin": "*",
                ]
                if let response = HTTPURLResponse(
                    url: entry.schemeTask.request.url ?? entry.upstream,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: headers,
                ) {
                    entry.schemeTask.didReceive(response)
                    entry.schemeTask.didReceive(body)
                }
            }
            entry.schemeTask.didFinish()
        }
    }

    private func rewriteManifest(
        body: Data,
        upstream: URL,
        referer: String?,
        userAgent: String?,
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

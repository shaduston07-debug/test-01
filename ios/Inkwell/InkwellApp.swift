// Inkwell Notes for iPad and iPhone: the web app (bundled in "web/") running
// full screen in a WKWebView, with the microphone, camera, links and the
// system share sheet wired up.

import SwiftUI
import UniformTypeIdentifiers
import WebKit

@main
struct InkwellApp: App {
    var body: some Scene {
        WindowGroup {
            NotesView()
                .ignoresSafeArea()   // the page pads itself with env(safe-area-inset-*)
        }
    }
}

struct NotesView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()   // notes, recordings and pictures persist

        let controller = config.userContentController
        controller.add(context.coordinator, name: "inkwellShare")
        // Lets the page know it runs as the installed app (safe-area padding, sharing).
        controller.addUserScript(WKUserScript(
            source: "document.documentElement.classList.add('native-app');",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        context.coordinator.webView = webView

        webView.load(URLRequest(url: URL(string: "\(BundleSchemeHandler.scheme)://app/index.html")!))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?

        // Links to websites (Wiktionary, dictionary sources) open in Safari.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = action.request.url, ["http", "https", "mailto", "tel"].contains(url.scheme ?? ""),
               action.targetFrame?.isMainFrame ?? true, action.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        // target="_blank" links.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }

        // The microphone for recordings (iOS still asks once, using the Info.plist text).
        @available(iOS 15.0, *)
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(.grant)
        }

        // Sharing an exported note: { name, data (base64) } → share sheet
        // (AirDrop, Mail, Messages, Save to Files …).
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "inkwellShare",
                  let body = message.body as? [String: Any],
                  let name = body["name"] as? String,
                  let base64 = body["data"] as? String,
                  let data = Data(base64Encoded: base64),
                  let webView = webView else { return }
            let safeName = name.replacingOccurrences(of: "/", with: "-")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
            do {
                try data.write(to: url, options: .atomic)
            } catch {
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = sheet.popoverPresentationController {   // iPad: anchor the popover
                popover.sourceView = webView
                popover.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            var top = webView.window?.rootViewController
            while let presented = top?.presentedViewController { top = presented }
            top?.present(sheet, animated: true)
        }
    }
}

/// Serves the bundled web app at inkwell://app/… so it has a stable origin of
/// its own (storage keeps working, and the microphone is allowed).
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "inkwell"
    private let root = Bundle.main.resourceURL!.appendingPathComponent("web").standardizedFileURL

    private static let types: [String: String] = [
        "html": "text/html", "css": "text/css", "js": "text/javascript", "json": "application/json",
        "webmanifest": "application/manifest+json", "svg": "image/svg+xml", "png": "image/png",
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "txt": "text/plain",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!)
            task.didFinish()
            return
        }
        let ext = file.pathExtension.lowercased()
        let mime = Self.types[ext] ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

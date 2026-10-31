import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        // the app was launched by opening a brush / palette / project file
        handle(connectionOptions.urlContexts)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if !handle(URLContexts) { SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    // Files opened from Files, Safari downloads or "Open in…": copy them into the app's temporary
    // folder (they may be outside the sandbox) and hand them to the web app, which imports them.
    @discardableResult
    private func handle(_ contexts: Set<UIOpenURLContext>) -> Bool {
        var handled = false
        for ctx in contexts where ctx.url.isFileURL {
            handled = true
            let src = ctx.url
            let scoped = src.startAccessingSecurityScopedResource()
            defer { if scoped { src.stopAccessingSecurityScopedResource() } }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("inbox", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let dst = dir.appendingPathComponent(UUID().uuidString + "-" + src.lastPathComponent)
            do {
                try FileManager.default.copyItem(at: src, to: dst)
                deliver(dst, name: src.lastPathComponent, attempt: 0)
            } catch {
                NSLog("Inkwell: could not copy opened file: \(error)")
            }
        }
        return handled
    }

    private func deliver(_ url: URL, name: String, attempt: Int) {
        guard let bridge = (window?.rootViewController as? CAPBridgeViewController)?.bridge,
              let web = bridge.webView,
              let path = bridge.portablePath(fromLocalURL: url) else {
            if attempt < 40 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.deliver(url, name: name, attempt: attempt + 1) } }
            return
        }
        let payload: [String: String] = ["url": path.absoluteString, "name": name]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        // queue it on window.__inkwellOpen (read on start-up) and notify a running app
        // only once the app has started (on a cold launch the page may still be loading)
        let js = "window.inkwellReady ? ((window.__inkwellOpen = window.__inkwellOpen || []).push(\(json)), window.dispatchEvent(new Event('inkwellopen')), 'ok') : 'wait'"
        web.evaluateJavaScript(js) { res, err in
            if (err != nil || (res as? String) != "ok") && attempt < 60 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.deliver(url, name: name, attempt: attempt + 1) } }
        }
    }
}

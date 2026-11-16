import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = InkwellBridgeViewController()
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

// The web view with the app's own native plugins registered
class InkwellBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(InkwellKeychainPlugin())
    }
}

// API keys and setup kept in the iOS Keychain: it outlives updates (and even deleting the app),
// so a new version starts with the Sketchfab key, the cloud backup and the settings in place.
@objc(InkwellKeychainPlugin)
public class InkwellKeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InkwellKeychainPlugin"
    public let jsName = "InkwellKeychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]
    private let service = "com.inkwell.studio.setup"

    private func query(_ account: String) -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account]
    }

    @objc func get(_ call: CAPPluginCall) {
        let account = call.getString("key") ?? "setup"
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecSuccess, let data = out as? Data, let text = String(data: data, encoding: .utf8) {
            call.resolve(["value": text])
        } else {
            call.resolve(["value": NSNull()])
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        let account = call.getString("key") ?? "setup"
        let value = call.getString("value") ?? ""
        SecItemDelete(query(account) as CFDictionary)
        if value.isEmpty { call.resolve(); return }
        var q = query(account)
        q[kSecValueData as String] = value.data(using: .utf8)!
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(q as CFDictionary, nil)
        if status == errSecSuccess { call.resolve() } else { call.reject("Keychain error \(status)") }
    }
}

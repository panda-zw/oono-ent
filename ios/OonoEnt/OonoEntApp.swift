import SwiftUI

@main
struct OonoEntApp: App {
    init() {
        // Must run before any media element is played, otherwise iOS keeps
        // the session in `.soloAmbient` and silences us on background.
        AudioSessionManager.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
                .statusBarHidden(false)
        }
    }
}

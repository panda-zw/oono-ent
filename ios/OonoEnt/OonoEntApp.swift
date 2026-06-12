import SwiftUI

@main
struct OonoEntApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
                .statusBarHidden(false)
        }
    }
}

import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            WebViewContainer()
                .ignoresSafeArea()
        }
    }
}

#Preview {
    ContentView()
}

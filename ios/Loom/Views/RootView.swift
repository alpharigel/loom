import SwiftUI

struct RootView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            switch app.phase {
            case .onboarding:
                OnboardingView()
            case .discovering:
                DiscoveryView()
            case .picker:
                ServerPickerView()
            case .connected(let server):
                WorkspaceView(server: server)
                    .id(server.id) // recreate on server change
            }
        }
        .animation(.easeInOut(duration: 0.25), value: phaseKey)
    }

    private var phaseKey: String {
        switch app.phase {
        case .onboarding:    return "onboarding"
        case .discovering:   return "discovering"
        case .picker:        return "picker"
        case .connected(let s): return "connected:\(s.id)"
        }
    }
}

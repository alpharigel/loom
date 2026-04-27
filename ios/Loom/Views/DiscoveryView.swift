import SwiftUI

struct DiscoveryView: View {
    @EnvironmentObject var app: AppState
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            ZStack {
                Circle()
                    .stroke(Theme.accent.opacity(0.3), lineWidth: 1.5)
                    .frame(width: pulse ? 140 : 60, height: pulse ? 140 : 60)
                    .opacity(pulse ? 0 : 0.8)
                    .animation(.easeOut(duration: 1.6).repeatForever(autoreverses: false), value: pulse)
                Circle()
                    .fill(Theme.accent)
                    .frame(width: 14, height: 14)
            }
            .frame(width: 160, height: 160)

            VStack(spacing: 6) {
                Text("Scanning your tailnet")
                    .font(Fonts.ui(16, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Text("Looking for Loom servers on port 3000")
                    .font(Fonts.ui(13))
                    .foregroundStyle(Theme.textMuted)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            pulse = true
            await app.discover()
        }
    }
}

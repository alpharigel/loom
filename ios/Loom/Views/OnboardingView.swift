import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var app: AppState
    @State private var apiKey = ""
    @State private var manualHost = ""
    @State private var manualPort = "3000"
    @State private var mode: Mode = .tailscale

    enum Mode: String, CaseIterable { case tailscale, manual }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                modePicker
                if mode == .tailscale { tailscaleForm } else { manualForm }
                Spacer(minLength: 40)
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 36)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                LoomMark()
                Text("LOOM")
                    .font(Fonts.mono(22, weight: .bold))
                    .tracking(4)
                    .foregroundStyle(Theme.text)
            }
            Text("Connect to your dev environment.")
                .font(Fonts.ui(15))
                .foregroundStyle(Theme.textMuted)
        }
        .padding(.top, 20)
    }

    private var modePicker: some View {
        HStack(spacing: 0) {
            ForEach(Mode.allCases, id: \.self) { m in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { mode = m }
                } label: {
                    Text(m == .tailscale ? "Tailscale" : "Manual")
                        .font(Fonts.ui(13, weight: .medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .foregroundStyle(mode == m ? Theme.bg : Theme.textMuted)
                        .background(mode == m ? Theme.accent : Color.clear)
                }
            }
        }
        .background(Theme.surfaceHi)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Theme.border, lineWidth: 0.5)
        )
    }

    private var tailscaleForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Tailscale API key")
                .font(Fonts.ui(12, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(Theme.textMuted)
            SecureField("tskey-api-…", text: $apiKey)
                .textFieldStyle(.plain)
                .font(Fonts.mono(14))
                .foregroundStyle(Theme.text)
                .padding(12)
                .background(Theme.surfaceLo)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border, lineWidth: 0.5))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            Text("Generate at admin.tailscale.com → Settings → Keys. We use it to list devices on your tailnet and find which ones are running Loom on port 3000. Stored in iOS Keychain only.")
                .font(Fonts.ui(12))
                .foregroundStyle(Theme.textDim)
                .lineSpacing(2)

            Button {
                app.saveAPIKey(apiKey)
            } label: {
                HStack {
                    Text("Continue")
                    Image(systemName: "arrow.right")
                }
                .font(Fonts.ui(14, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(apiKey.isEmpty ? Theme.surfaceHi : Theme.accent)
                .foregroundStyle(apiKey.isEmpty ? Theme.textDim : Theme.bg)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .disabled(apiKey.isEmpty)
        }
    }

    private var manualForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Add a server by host")
                .font(Fonts.ui(12, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(Theme.textMuted)

            HStack(spacing: 8) {
                TextField("100.x.x.x or hostname", text: $manualHost)
                    .textFieldStyle(.plain)
                    .font(Fonts.mono(14))
                    .padding(12)
                    .background(Theme.surfaceLo)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border, lineWidth: 0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                TextField("port", text: $manualPort)
                    .textFieldStyle(.plain)
                    .font(Fonts.mono(14))
                    .frame(width: 80)
                    .padding(12)
                    .background(Theme.surfaceLo)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border, lineWidth: 0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .keyboardType(.numberPad)
            }

            Button {
                Task {
                    let port = Int(manualPort) ?? 3000
                    await app.addManualServer(host: manualHost, port: port)
                    if app.discoveryError == nil {
                        app.phase = .picker
                    }
                }
            } label: {
                Text("Add server")
                    .font(Fonts.ui(14, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.accent)
                    .foregroundStyle(Theme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .disabled(manualHost.isEmpty)

            if let err = app.discoveryError {
                Text(err)
                    .font(Fonts.ui(12))
                    .foregroundStyle(Theme.danger)
            }
        }
    }
}

struct LoomMark: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Theme.accent)
                .frame(width: 28, height: 28)
            Text("L")
                .font(Fonts.mono(16, weight: .heavy))
                .foregroundStyle(Theme.bg)
        }
    }
}

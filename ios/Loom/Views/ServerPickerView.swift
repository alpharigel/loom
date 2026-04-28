import SwiftUI

struct ServerPickerView: View {
    @EnvironmentObject var app: AppState
    @State private var showAddManual = false
    @State private var showSettings = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().background(Theme.border)
            content
        }
        .sheet(isPresented: $showAddManual) {
            AddServerSheet().environmentObject(app)
        }
        .sheet(isPresented: $showSettings) {
            SettingsSheet().environmentObject(app)
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 10) {
                LoomMark()
                Text("LOOM")
                    .font(Fonts.mono(16, weight: .bold))
                    .tracking(3)
                    .foregroundStyle(Theme.text)
            }
            Spacer()
            Button { showAddManual = true } label: {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .padding(8)
                    .background(Theme.surfaceHi)
                    .clipShape(Circle())
            }
            Button { showSettings = true } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .padding(8)
                    .background(Theme.surfaceHi)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let err = app.discoveryError {
                    Text(err)
                        .font(Fonts.ui(12))
                        .foregroundStyle(Theme.danger)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.danger.opacity(0.1))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.danger.opacity(0.4), lineWidth: 0.5))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                Text("AVAILABLE SERVERS")
                    .font(Fonts.mono(11, weight: .semibold))
                    .tracking(2)
                    .foregroundStyle(Theme.textDim)
                    .padding(.top, 8)

                if app.servers.isEmpty {
                    EmptyStateCard()
                } else {
                    ForEach(app.servers) { server in
                        ServerCard(server: server) {
                            app.connect(to: server)
                        }
                    }
                }

                Button {
                    Task { await app.discover() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.clockwise")
                        Text("Rescan")
                    }
                    .font(Fonts.ui(13, weight: .medium))
                    .foregroundStyle(Theme.textMuted)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity)
                    .background(Theme.surface)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border, lineWidth: 0.5))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
    }
}

private struct ServerCard: View {
    let server: LoomServer
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                osBadge
                VStack(alignment: .leading, spacing: 4) {
                    Text(server.name)
                        .font(Fonts.ui(15, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    HStack(spacing: 6) {
                        Circle()
                            .fill(server.isOnline ? Theme.success : Theme.textDim)
                            .frame(width: 6, height: 6)
                        Text("\(server.host):\(server.port)")
                            .font(Fonts.mono(12))
                            .foregroundStyle(Theme.textMuted)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textDim)
            }
            .padding(14)
            .background(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border, lineWidth: 0.5))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private var osBadge: some View {
        let icon: String
        switch server.os?.lowercased() {
        case let s? where s.contains("darwin") || s.contains("mac"): icon = "laptopcomputer"
        case let s? where s.contains("linux"): icon = "server.rack"
        case let s? where s.contains("win"):   icon = "pc"
        default: icon = "cube"
        }
        return Image(systemName: icon)
            .font(.system(size: 18))
            .foregroundStyle(Theme.accent)
            .frame(width: 36, height: 36)
            .background(Theme.surfaceHi)
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct EmptyStateCard: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "antenna.radiowaves.left.and.right.slash")
                .font(.system(size: 28))
                .foregroundStyle(Theme.textDim)
            Text("No Loom servers found")
                .font(Fonts.ui(14, weight: .medium))
                .foregroundStyle(Theme.text)
            Text("Make sure Tailscale is connected and Loom is running on port 3000.")
                .font(Fonts.ui(12))
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(Theme.surface)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border, lineWidth: 0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct AddServerSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) var dismiss
    @State private var host = ""
    @State private var port = "3000"
    @State private var isAdding = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Connect manually if Tailscale discovery missed a host (e.g. local LAN address).")
                    .font(Fonts.ui(13))
                    .foregroundStyle(Theme.textMuted)

                LabeledField(label: "Host", text: $host, placeholder: "100.x.x.x or hostname.ts.net", mono: true)
                LabeledField(label: "Port", text: $port, placeholder: "3000", mono: true, keyboard: .numberPad)

                Button {
                    isAdding = true
                    Task {
                        await app.addManualServer(host: host, port: Int(port) ?? 3000)
                        isAdding = false
                        if app.discoveryError == nil { dismiss() }
                    }
                } label: {
                    Text(isAdding ? "Adding…" : "Add server")
                        .font(Fonts.ui(14, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(host.isEmpty ? Theme.surfaceHi : Theme.accent)
                        .foregroundStyle(host.isEmpty ? Theme.textDim : Theme.bg)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .disabled(host.isEmpty || isAdding)

                if let err = app.discoveryError {
                    Text(err).font(Fonts.ui(12)).foregroundStyle(Theme.danger)
                }
                Spacer()
            }
            .padding(20)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Add Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.tint(Theme.textMuted)
                }
            }
        }
    }
}

struct LabeledField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var mono: Bool = false
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(Fonts.mono(10, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(Theme.textDim)
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(mono ? Fonts.mono(14) : Fonts.ui(14))
                .foregroundStyle(Theme.text)
                .padding(10)
                .background(Theme.surfaceLo)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border, lineWidth: 0.5))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .keyboardType(keyboard)
        }
    }
}

struct SettingsSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Profile") {
                    HStack {
                        Text("Active profile")
                        Spacer()
                        Text(app.activeProfile)
                            .foregroundStyle(Theme.textMuted)
                            .font(Fonts.mono(13))
                    }
                }
                .listRowBackground(Theme.surface)

                Section("Tailscale") {
                    Button(role: .destructive) {
                        app.clearAPIKey()
                        dismiss()
                    } label: {
                        Text("Sign out / clear API key")
                    }
                }
                .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}

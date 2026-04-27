import SwiftUI

/// Three-pane workspace: project browser | terminal | files+editor.
///
/// On compact widths (iPhone) we show one pane at a time and switch via a
/// segmented control. On regular widths (iPad) all three panes are visible.
struct WorkspaceView: View {
    @EnvironmentObject var app: AppState
    let server: LoomServer

    @StateObject private var workspace: WorkspaceModel

    private static func icon(for pane: WorkspaceModel.Pane) -> String {
        switch pane {
        case .projects: return "folder"
        case .terminal: return "terminal"
        case .files:    return "doc.text"
        }
    }

    init(server: LoomServer) {
        self.server = server
        _workspace = StateObject(wrappedValue: WorkspaceModel(server: server))
    }

    var body: some View {
        GeometryReader { geo in
            let regular = geo.size.width >= 800
            VStack(spacing: 0) {
                topBar
                Divider().background(Theme.border)
                if regular {
                    threePane
                } else {
                    compactPaneBody
                    Divider().background(Theme.border)
                    paneSwitcher
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await workspace.bootstrap() }
        .environmentObject(workspace)
    }

    private var topBar: some View {
        HStack(spacing: 14) {
            Button { app.disconnect() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textMuted)
                    .padding(8)
                    .background(Theme.surfaceHi)
                    .clipShape(Circle())
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Circle().fill(workspace.connected ? Theme.success : Theme.warning).frame(width: 6, height: 6)
                    Text(server.name)
                        .font(Fonts.ui(14, weight: .semibold))
                        .foregroundStyle(Theme.text)
                }
                Text("\(server.host):\(server.port)")
                    .font(Fonts.mono(11))
                    .foregroundStyle(Theme.textDim)
            }
            Spacer()
            if let active = workspace.activeProject {
                HStack(spacing: 6) {
                    Image(systemName: "folder.fill").font(.system(size: 11))
                    Text(active.name).font(Fonts.mono(12))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Theme.surfaceHi)
                .clipShape(Capsule())
                .foregroundStyle(Theme.accent)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var threePane: some View {
        HStack(spacing: 0) {
            ProjectBrowserView()
                .frame(width: 280)
            Divider().background(Theme.border)
            TerminalPaneView()
                .frame(maxWidth: .infinity)
            Divider().background(Theme.border)
            FilesPaneView()
                .frame(width: 360)
        }
    }

    @ViewBuilder
    private var compactPaneBody: some View {
        switch workspace.compactPane {
        case .projects: ProjectBrowserView()
        case .terminal: TerminalPaneView()
        case .files:    FilesPaneView()
        }
    }

    private var paneSwitcher: some View {
        HStack(spacing: 0) {
            ForEach([WorkspaceModel.Pane.projects, .terminal, .files], id: \.self) { pane in
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { workspace.compactPane = pane }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: Self.icon(for: pane)).font(.system(size: 16, weight: .medium))
                        Text(pane.rawValue.capitalized).font(Fonts.ui(10, weight: .medium))
                    }
                    .foregroundStyle(workspace.compactPane == pane ? Theme.accent : Theme.textMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(workspace.compactPane == pane ? Theme.surfaceHi : Color.clear)
                }
            }
        }
        .background(Theme.surface)
    }
}

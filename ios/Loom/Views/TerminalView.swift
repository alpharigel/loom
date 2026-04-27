import SwiftUI
import SwiftTerm
import UIKit

struct TerminalPaneView: View {
    @EnvironmentObject var workspace: WorkspaceModel
    @State private var activeTab: Tab = .agent

    enum Tab: String, CaseIterable, Identifiable {
        case agent, scratch
        var id: String { rawValue }
        var label: String { self == .agent ? "Agent" : "Scratch" }
        var icon: String  { self == .agent ? "sparkles" : "terminal" }
    }

    var body: some View {
        VStack(spacing: 0) {
            tabBar
            Divider().background(Theme.border)
            ZStack {
                Theme.surfaceLo
                if workspace.activeProject == nil {
                    placeholder
                } else {
                    SwiftTermContainer(
                        terminalID: terminalID,
                        cwd: workspace.agentCwd,
                        sticky: activeTab == .agent,
                        socket: workspace.socket
                    )
                    .id("\(terminalID)-\(workspace.agentCwd)")
                }
            }
        }
    }

    private var terminalID: String {
        let suffix = activeTab == .agent ? "agent" : "scratch"
        return "ios-\(suffix)-\(workspace.agentCwd.hashValue)"
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases) { tab in
                Button { activeTab = tab } label: {
                    HStack(spacing: 6) {
                        Image(systemName: tab.icon).font(.system(size: 11))
                        Text(tab.label).font(Fonts.ui(12, weight: .medium))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .foregroundStyle(activeTab == tab ? Theme.accent : Theme.textMuted)
                    .background(
                        activeTab == tab
                            ? Theme.surfaceLo
                            : Theme.surface
                    )
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(activeTab == tab ? Theme.accent : Color.clear)
                            .frame(height: 2)
                    }
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .background(Theme.surface)
    }

    private var placeholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "terminal")
                .font(.system(size: 32))
                .foregroundStyle(Theme.textDim)
            Text("Select a project to start a terminal")
                .font(Fonts.ui(13))
                .foregroundStyle(Theme.textMuted)
        }
    }
}

// MARK: - SwiftTerm UIKit bridge

struct SwiftTermContainer: UIViewRepresentable {
    let terminalID: String
    let cwd: String
    let sticky: Bool
    let socket: TerminalSocket

    func makeCoordinator() -> Coordinator {
        Coordinator(terminalID: terminalID, socket: socket)
    }

    func makeUIView(context: Context) -> SwiftTerm.TerminalView {
        let view = SwiftTerm.TerminalView(frame: .zero)
        view.backgroundColor = UIColor(Theme.surfaceLo)
        view.nativeForegroundColor = UIColor(Theme.text)
        view.nativeBackgroundColor = UIColor(Theme.surfaceLo)
        view.terminalDelegate = context.coordinator
        context.coordinator.attach(view: view, cwd: cwd, sticky: sticky)
        return view
    }

    func updateUIView(_ uiView: SwiftTerm.TerminalView, context: Context) {
        // Resizing is handled by SwiftTerm.TerminalView automatically.
    }

    static func dismantleUIView(_ uiView: SwiftTerm.TerminalView, coordinator: Coordinator) {
        coordinator.dismantle()
    }

    final class Coordinator: NSObject, TerminalViewDelegate {
        let terminalID: String
        let socket: TerminalSocket
        weak var view: SwiftTerm.TerminalView?

        init(terminalID: String, socket: TerminalSocket) {
            self.terminalID = terminalID
            self.socket = socket
        }

        func attach(view: SwiftTerm.TerminalView, cwd: String, sticky: Bool) {
            self.view = view
            let cols = Int(view.getTerminal().cols)
            let rows = Int(view.getTerminal().rows)
            socket.createTerminal(
                id: terminalID,
                cwd: cwd,
                cols: max(cols, 80),
                rows: max(rows, 24),
                sticky: sticky,
                onData: { [weak view] bytes in
                    DispatchQueue.main.async {
                        view?.feed(byteArray: [UInt8](bytes)[...])
                    }
                },
                onExit: { _ in },
                onError: { _ in }
            )
        }

        func dismantle() {
            socket.closeTerminal(id: terminalID)
        }

        // MARK: TerminalViewDelegate

        func send(source: SwiftTerm.TerminalView, data: ArraySlice<UInt8>) {
            let str = String(bytes: data, encoding: .utf8) ?? ""
            socket.sendInput(id: terminalID, str)
        }

        func sizeChanged(source: SwiftTerm.TerminalView, newCols: Int, newRows: Int) {
            socket.resize(id: terminalID, cols: newCols, rows: newRows)
        }

        func scrolled(source: SwiftTerm.TerminalView, position: Double) {}
        func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {}
        func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {}
        func requestOpenLink(source: SwiftTerm.TerminalView, link: String, params: [String : String]) {
            if let url = URL(string: link) { UIApplication.shared.open(url) }
        }
        func bell(source: SwiftTerm.TerminalView) {}
        func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
            if let s = String(data: content, encoding: .utf8) {
                UIPasteboard.general.string = s
            }
        }
        func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {}
    }
}


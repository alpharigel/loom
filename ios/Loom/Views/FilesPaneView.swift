import SwiftUI

struct FilesPaneView: View {
    @EnvironmentObject var workspace: WorkspaceModel
    @State private var path: String = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().background(Theme.border)
            if let file = workspace.openedFile {
                FileEditorView(file: file)
            } else {
                fileBrowser
            }
        }
        .background(Theme.surfaceLo)
        .onChange(of: workspace.fileRoot) { _, new in
            path = new
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            if workspace.openedFile != nil {
                Button {
                    workspace.openedFile = nil
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textMuted)
                }
            }
            Text("FILES")
                .font(Fonts.mono(11, weight: .semibold))
                .tracking(2)
                .foregroundStyle(Theme.textDim)
            Spacer()
            if let file = workspace.openedFile {
                Text(file.name)
                    .font(Fonts.mono(11))
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(1)
            } else {
                Button {
                    Task { await workspace.refreshFiles(at: workspace.fileRoot) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textMuted)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var fileBrowser: some View {
        VStack(spacing: 0) {
            breadcrumbs
            Divider().background(Theme.border)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let parent = parentPath {
                        FileRow(name: "..", isDirectory: true, isHidden: false) {
                            Task { await workspace.refreshFiles(at: parent) }
                        }
                    }
                    ForEach(workspace.fileListing) { entry in
                        FileRow(name: entry.name,
                                isDirectory: entry.isDirectory,
                                isHidden: entry.isHidden ?? false) {
                            if entry.isDirectory {
                                Task { await workspace.refreshFiles(at: entry.path) }
                            } else {
                                Task { await workspace.openFile(entry) }
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            if workspace.fileListing.isEmpty && workspace.activeProject == nil {
                Text("Select a project to browse files")
                    .font(Fonts.ui(12))
                    .foregroundStyle(Theme.textDim)
                    .padding(20)
            }
        }
    }

    private var parentPath: String? {
        let p = workspace.fileRoot
        guard !p.isEmpty else { return nil }
        let url = URL(fileURLWithPath: p)
        let parent = url.deletingLastPathComponent().path
        return parent != p ? parent : nil
    }

    private var breadcrumbs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                Text(workspace.fileRoot)
                    .font(Fonts.mono(10))
                    .foregroundStyle(Theme.textMuted)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
        }
    }
}

private struct FileRow: View {
    let name: String
    let isDirectory: Bool
    let isHidden: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                    .foregroundStyle(isDirectory ? Theme.accent : Theme.textMuted)
                    .frame(width: 14)
                Text(name)
                    .font(Fonts.mono(12))
                    .foregroundStyle(isHidden ? Theme.textDim : Theme.text)
                    .lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var icon: String {
        if name == ".." { return "arrow.turn.left.up" }
        if isDirectory { return "folder.fill" }
        let ext = (name as NSString).pathExtension.lowercased()
        switch ext {
        case "md":                  return "doc.text"
        case "swift", "js", "ts", "py", "go", "rb", "rs": return "chevron.left.forwardslash.chevron.right"
        case "json", "yml", "yaml", "toml": return "doc.badge.gearshape"
        case "png", "jpg", "jpeg", "gif", "svg": return "photo"
        default: return "doc"
        }
    }
}

private struct FileEditorView: View {
    @EnvironmentObject var workspace: WorkspaceModel
    let file: FileContent
    @State private var content: String = ""
    @State private var dirty: Bool = false
    @State private var saving: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                if dirty {
                    Circle().fill(Theme.warning).frame(width: 6, height: 6)
                }
                Spacer()
                Button {
                    saving = true
                    Task {
                        await workspace.saveFile(content)
                        dirty = false
                        saving = false
                    }
                } label: {
                    Text(saving ? "Saving…" : "Save")
                        .font(Fonts.ui(12, weight: .semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(dirty ? Theme.accent : Theme.surfaceHi)
                        .foregroundStyle(dirty ? Theme.bg : Theme.textDim)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                .disabled(!dirty || saving)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Theme.surface)

            Divider().background(Theme.border)

            TextEditor(text: $content)
                .scrollContentBackground(.hidden)
                .background(Theme.surfaceLo)
                .font(Fonts.mono(13))
                .foregroundStyle(Theme.text)
                .tint(Theme.accent)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onChange(of: content) { _, _ in dirty = true }
        }
        .onAppear {
            content = file.content
            dirty = false
        }
        .onChange(of: file.path) { _, _ in
            content = file.content
            dirty = false
        }
    }
}

import Foundation
import SwiftUI

/// State shared between the three workspace panes for a single server.
@MainActor
final class WorkspaceModel: ObservableObject {
    let server: LoomServer
    let client: LoomClient
    let socket: TerminalSocket

    enum Pane: String { case projects, terminal, files }

    @Published var connected: Bool = false
    @Published var sections: [ProjectSection: [ProjectItem]] = [:]
    @Published var activeProject: ProjectItem?
    @Published var activeWorktree: Worktree?
    @Published var loadError: String?
    @Published var compactPane: Pane = .projects

    @Published var fileRoot: String = ""
    @Published var fileListing: [FileEntry] = []
    @Published var openedFile: FileContent?

    /// The cwd for the agent terminal (project or worktree path).
    var agentCwd: String {
        activeWorktree?.path ?? activeProject?.path ?? NSHomeDirectory()
    }

    init(server: LoomServer) {
        self.server = server
        self.client = LoomClient(baseURL: server.baseURL)
        self.socket = TerminalSocket(baseURL: server.baseURL)
    }

    func bootstrap() async {
        await loadProjects()
        socket.onFsChange = { [weak self] _, _ in
            Task { @MainActor in await self?.loadProjects(silent: true) }
        }
        socket.connect()
        connected = true
    }

    func loadProjects(silent: Bool = false) async {
        do {
            let r = try await client.projects()
            sections = [
                .projects: r.projects ?? [],
                .scratch:  r.scratch  ?? [],
                .agents:   r.agents   ?? [],
                .skills:   r.skills   ?? [],
                .archived: r.archived ?? []
            ]
            loadError = nil
        } catch {
            if !silent {
                loadError = (error as? LocalizedError)?.errorDescription ?? "\(error)"
            }
        }
    }

    func selectProject(_ project: ProjectItem, worktree: Worktree? = nil) {
        activeProject = project
        activeWorktree = worktree
        compactPane = .terminal
        Task { await refreshFiles(at: worktree?.path ?? project.path) }
    }

    // MARK: Worktrees

    func createWorktree(project: ProjectItem, branch: String) async {
        guard let section = project.section else { return }
        do {
            _ = try await client.createWorktree(project: project.name, section: section, branch: branch)
            await loadProjects(silent: true)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        }
    }

    func deleteWorktree(project: ProjectItem, worktree: Worktree) async {
        guard let section = project.section else { return }
        do {
            try await client.deleteWorktree(project: project.name, section: section, branch: worktree.branch)
            await loadProjects(silent: true)
            if activeWorktree?.id == worktree.id { activeWorktree = nil }
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        }
    }

    // MARK: Files

    func refreshFiles(at path: String) async {
        fileRoot = path
        do {
            let listing = try await client.listFiles(path: path)
            fileListing = listing.files
        } catch {
            fileListing = []
        }
    }

    func openFile(_ entry: FileEntry) async {
        guard !entry.isDirectory else { return }
        do {
            openedFile = try await client.readFile(path: entry.path)
        } catch {
            openedFile = nil
        }
    }

    func saveFile(_ content: String) async {
        guard let file = openedFile else { return }
        do {
            try await client.writeFile(path: file.path, content: content)
            openedFile = FileContent(path: file.path, name: file.name, content: content, ext: file.ext)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        }
    }
}

// Ensure ProjectItem carries its section through the API response.
extension ProjectItem {
    func with(section: ProjectSection) -> ProjectItem {
        var copy = self
        copy.section = section
        return copy
    }
}

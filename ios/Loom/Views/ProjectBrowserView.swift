import SwiftUI

struct ProjectBrowserView: View {
    @EnvironmentObject var workspace: WorkspaceModel
    @State private var expanded: Set<ProjectSection> = Set(ProjectSection.allCases)
    @State private var expandedProjects: Set<String> = []
    @State private var collapsedProjects: Set<String> = []
    @State private var creatingWorktreeFor: ProjectItem?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().background(Theme.border)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(ProjectSection.allCases) { section in
                        if let items = workspace.sections[section], !items.isEmpty {
                            sectionHeader(section)
                            if expanded.contains(section) {
                                ForEach(items) { item in
                                    projectRow(item.with(section: section))
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 8)
            }
            .onAppear { autoExpandAll() }
            .onChange(of: workspace.sections.count) { _, _ in autoExpandAll() }
            if let err = workspace.loadError {
                Text(err)
                    .font(Fonts.ui(11))
                    .foregroundStyle(Theme.danger)
                    .padding(8)
            }
        }
        .background(Theme.surfaceLo)
        .sheet(item: $creatingWorktreeFor) { project in
            CreateWorktreeSheet(project: project)
                .environmentObject(workspace)
        }
    }

    private var header: some View {
        HStack {
            Text("PROJECTS")
                .font(Fonts.mono(11, weight: .semibold))
                .tracking(2)
                .foregroundStyle(Theme.textDim)
            Spacer()
            Button {
                Task { await workspace.loadProjects() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func sectionHeader(_ section: ProjectSection) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                if expanded.contains(section) { expanded.remove(section) }
                else { expanded.insert(section) }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: expanded.contains(section) ? "chevron.down" : "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .frame(width: 10)
                Text(section.title.uppercased())
                    .font(Fonts.mono(10, weight: .semibold))
                    .tracking(1.5)
                Spacer()
                Text("\(workspace.sections[section]?.count ?? 0)")
                    .font(Fonts.mono(10))
                    .foregroundStyle(Theme.textDim)
            }
            .foregroundStyle(Theme.textMuted)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
    }

    private func autoExpandAll() {
        expanded = Set(ProjectSection.allCases)
        let withWorktrees = workspace.sections.values.flatMap { $0 }
            .filter { !($0.worktrees ?? []).isEmpty }
            .map { $0.id }
        expandedProjects = Set(withWorktrees).subtracting(collapsedProjects)
    }

    @ViewBuilder
    private func projectRow(_ project: ProjectItem) -> some View {
        let isExpanded = expandedProjects.contains(project.id)
        let isProjectActive = workspace.activeProject?.id == project.id
        let isActive = isProjectActive && workspace.activeWorktree == nil
        let containsActiveWorktree = isProjectActive && workspace.activeWorktree != nil
        let hasWorktrees = !(project.worktrees ?? []).isEmpty

        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    if hasWorktrees {
                        if isExpanded {
                            expandedProjects.remove(project.id)
                            collapsedProjects.insert(project.id)
                        } else {
                            expandedProjects.insert(project.id)
                            collapsedProjects.remove(project.id)
                        }
                    }
                } label: {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(hasWorktrees ? Theme.textMuted : Color.clear)
                        .frame(width: 10)
                }
                .buttonStyle(.plain)

                Image(systemName: hasWorktrees ? "folder" : "folder.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(isProjectActive ? Theme.accent : Theme.textMuted)

                Button {
                    if hasWorktrees {
                        // Folder is non-selectable when worktrees exist —
                        // tap toggles expansion instead.
                        if isExpanded {
                            expandedProjects.remove(project.id)
                            collapsedProjects.insert(project.id)
                        } else {
                            expandedProjects.insert(project.id)
                            collapsedProjects.remove(project.id)
                        }
                    } else {
                        workspace.selectProject(project)
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(project.name)
                            .font(Fonts.ui(13, weight: isProjectActive ? .semibold : .regular))
                            .foregroundStyle(
                                hasWorktrees ? Theme.textMuted
                                : (isProjectActive ? Theme.text : Theme.textMuted)
                            )
                            .lineLimit(1)
                        if containsActiveWorktree {
                            Image(systemName: "circle.fill")
                                .font(.system(size: 4))
                                .foregroundStyle(Theme.accent.opacity(0.7))
                        }
                        Spacer()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)

                Menu {
                    Button { creatingWorktreeFor = project } label: {
                        Label("New worktree…", systemImage: "plus.circle")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textDim)
                        .frame(width: 24, height: 24)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                ZStack(alignment: .leading) {
                    if isActive { Theme.surfaceHi } else { Color.clear }
                    Rectangle()
                        .fill(isActive ? Theme.accent : Color.clear)
                        .frame(width: 2)
                }
            )

            if isExpanded {
                ForEach(project.worktrees ?? []) { wt in
                    worktreeRow(project: project, worktree: wt)
                }
            }
        }
    }

    private func worktreeRow(project: ProjectItem, worktree: Worktree) -> some View {
        let isActive = workspace.activeWorktree?.id == worktree.id
        return HStack(spacing: 8) {
            Spacer().frame(width: 24)
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 10))
                .foregroundStyle(isActive ? Theme.accent : Theme.textDim)
            Button {
                workspace.selectProject(project, worktree: worktree)
            } label: {
                Text(worktree.branch)
                    .font(Fonts.mono(12, weight: isActive ? .semibold : .regular))
                    .foregroundStyle(isActive ? Theme.text : Theme.textMuted)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            Menu {
                Button(role: .destructive) {
                    Task { await workspace.deleteWorktree(project: project, worktree: worktree) }
                } label: {
                    Label("Delete worktree", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 10)).foregroundStyle(Theme.textDim)
                    .frame(width: 24, height: 24)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(
            ZStack(alignment: .leading) {
                if isActive { Theme.surfaceHi } else { Color.clear }
                Rectangle()
                    .fill(isActive ? Theme.accent : Color.clear)
                    .frame(width: 2)
            }
        )
    }
}

struct CreateWorktreeSheet: View {
    @EnvironmentObject var workspace: WorkspaceModel
    @Environment(\.dismiss) var dismiss
    let project: ProjectItem
    @State private var branch = ""
    @State private var creating = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("Create a worktree on \(project.name)")
                    .font(Fonts.ui(14))
                    .foregroundStyle(Theme.textMuted)

                LabeledField(label: "Branch", text: $branch, placeholder: "feature/my-branch", mono: true)

                Button {
                    creating = true
                    Task {
                        await workspace.createWorktree(project: project, branch: branch)
                        creating = false
                        dismiss()
                    }
                } label: {
                    Text(creating ? "Creating…" : "Create worktree")
                        .font(Fonts.ui(14, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(branch.isEmpty ? Theme.surfaceHi : Theme.accent)
                        .foregroundStyle(branch.isEmpty ? Theme.textDim : Theme.bg)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .disabled(branch.isEmpty || creating)

                Spacer()
            }
            .padding(20)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("New Worktree")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.tint(Theme.textMuted)
                }
            }
        }
    }
}

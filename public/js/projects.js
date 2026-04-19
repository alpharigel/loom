// ============================================================
// Projects — Left pane project navigator
// ============================================================

const Projects = {
  worktreeTarget: null, // project name for creating worktree
  worktreeSection: null, // section type for creating worktree

  init() {
    this.setupNewItem();
    this.setupNewWorktree();
    this.setupCommandConfig();
    this.setupDragAndDrop();

    // Listen for filesystem changes
    App.on('fs:changed', () => this.refresh());

    // Listen for agent status changes to update dots
    App.on('agent:status:updated', () => this.updateStatusDots());

    // Re-highlight on project selection
    App.on('project:selected', () => this.highlightActive());

    // Initial load — but skip if no profile is chosen yet. Rendering the
    // no-profile result would briefly show the global scratch/agents dirs,
    // then flip to the profile-scoped view once the user picks, which looks
    // like the whole sidebar refreshing and swapping content.
    // selectProfile() fires its own refresh(), so we pick up cleanly then.
    if (App.state.profile) {
      this.refresh();
    }

    // Safety-net polling: catch anything fs:changed misses (e.g. new
    // worktrees nested past the watcher depth). Also skip when there's no
    // profile — we'd just re-trigger the same flash described above.
    setInterval(() => {
      if (App.state.profile) this.refresh();
    }, 5000);
  },

  _lastFingerprint: null,

  async refresh() {
    try {
      const data = await App.api('GET', '/projects');

      // Skip re-render if nothing changed
      const fingerprint = JSON.stringify([
        (data.projects || []).map(p => p.name),
        (data.scratch || []).map(p => p.name),
        (data.agents || []).map(p => p.name),
        (data.skills || []).map(p => p.name),
        (data.archived || []).map(p => p.name),
      ]);
      const topLevelChanged = fingerprint !== this._lastFingerprint;
      if (topLevelChanged) {
        this._lastFingerprint = fingerprint;

        App.state.projects = data.projects;
        App.state.scratch = data.scratch || [];
        App.state.agents = data.agents || [];
        App.state.skills = data.skills || [];
        App.state.archived = data.archived;
        this.render(data);

        // Restore last selected project on first load
        if (!App.state.selectedProject) {
          try {
            const saved = JSON.parse(localStorage.getItem('loom:selectedProject'));
            if (saved && saved.path) {
              App.selectProject(saved);
            }
          } catch { /* ignore */ }
        }
      }

      // Always lazy-load worktrees so additions/removals inside an
      // existing project propagate even when the top-level fingerprint
      // is unchanged. lazyLoadWorktrees has its own per-project diff.
      const allItems = [
        ...(data.scratch || []),
        ...(data.agents || []),
        ...data.projects,
      ];
      this.lazyLoadWorktrees(allItems);
    } catch (err) {
      App.toast('Failed to load projects: ' + err.message, 'error');
    }
  },

  async lazyLoadWorktrees(items) {
    await Promise.all(items.map(async (item) => {
      try {
        const section = item.section || 'projects';
        const data = await App.api('GET', `/projects/${encodeURIComponent(item.name)}/worktrees?section=${section}`);
        const existing = item.worktrees || [];
        const newPaths = data.worktrees.map(w => w.path).sort().join(',');
        const oldPaths = existing.map(w => w.path).sort().join(',');
        if (newPaths !== oldPaths) {
          item.worktrees = data.worktrees;
          this.updateProjectWorktrees(item);
        }
      } catch { /* ignore per-item failures */ }
    }));
  },

  updateProjectWorktrees(item) {
    const list = document.getElementById('project-list');
    // Remove existing worktree items for this item
    list.querySelectorAll(`.worktree-item[data-parent="${item.name}"]`).forEach(el => el.remove());
    // Find the item element and insert worktrees after it
    const itemEl = list.querySelector(`.project-item[data-name="${item.name}"]`);
    if (!itemEl || !item.worktrees || item.worktrees.length === 0) return;

    const section = item.section || 'projects';
    let insertAfter = itemEl;
    for (const wt of item.worktrees) {
      const wtEl = this.createWorktreeItem(item.name, wt, section);
      insertAfter.after(wtEl);
      insertAfter = wtEl;
    }
    // Update state in the appropriate section
    const stateList = App.state[section === 'projects' ? 'projects' : section] || [];
    const stateItem = stateList.find(p => p.name === item.name);
    if (stateItem) stateItem.worktrees = item.worktrees;
  },

  SECTION_ICONS: { scratch: '⚡', agents: '●', projects: '◆', skills: '⚙' },

  render(data) {
    const list = document.getElementById('project-list');
    list.innerHTML = '';

    // Sections — always shown with + buttons
    const scratch = data.scratch || [];
    const agents = data.agents || [];
    const skills = data.skills || [];

    this.renderSection(list, { label: 'Scratch', items: scratch, sectionType: 'scratch' });
    this.renderSection(list, { label: 'Agents', items: agents, sectionType: 'agents' });
    this.renderSection(list, { label: 'Projects', items: data.projects, sectionType: 'projects' });
    this.renderSection(list, { label: 'Skills', items: skills, sectionType: 'skills' });

    // Archive section
    if (data.archived.length > 0) {
      const archiveSection = document.createElement('div');
      archiveSection.className = 'archive-section';

      const toggle = document.createElement('div');
      toggle.className = 'archive-toggle';
      toggle.innerHTML = `<span class="chevron">▸</span> Archive (${data.archived.length})`;
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('open');
        archiveList.classList.toggle('open');
      });
      archiveSection.appendChild(toggle);

      const archiveList = document.createElement('div');
      archiveList.className = 'archive-list';

      for (const arch of data.archived) {
        const archEl = document.createElement('div');
        archEl.className = 'archived-item';
        archEl.innerHTML = `
          <span style="font-size: 11px; opacity: 0.5;">◇</span>
          <span class="project-name" style="font-size: 12px; color: var(--text-tertiary);">${this.esc(arch.name)}</span>
          <div class="archived-actions">
            <button class="project-action-btn" title="Unarchive" data-action="unarchive" data-name="${this.esc(arch.name)}">↩</button>
          </div>
        `;
        archEl.querySelector('[data-action="unarchive"]').addEventListener('click', (e) => {
          e.stopPropagation();
          this.unarchiveProject(arch.name);
        });
        archiveList.appendChild(archEl);
      }

      archiveSection.appendChild(archiveList);
      list.appendChild(archiveSection);
    }

    // Re-highlight active
    this.highlightActive();
    this.updateStatusDots();
  },

  renderSection(list, { label, items, sectionType }) {
    const header = document.createElement('div');
    header.className = 'project-section-label';
    header.innerHTML = `
      <span class="section-label-text">${this.esc(label)}</span>
      <button class="section-add-btn" title="New ${label.toLowerCase().replace(/s$/, '')}" data-section="${sectionType}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    `;

    header.querySelector('.section-add-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSectionAdd(sectionType);
    });

    list.appendChild(header);

    const content = document.createElement('div');
    content.className = `section-content section-${sectionType}`;

    const icon = this.SECTION_ICONS[sectionType] || '◆';
    for (const item of items) {
      const el = this.createProjectItem({
        name: item.name,
        path: item.path,
        icon,
        type: sectionType,
        section: sectionType,
        worktrees: item.worktrees,
        command: item.command,
        hasIcon: item.hasIcon,
      });
      content.appendChild(el);

      if (item.worktrees && item.worktrees.length > 0) {
        for (const wt of item.worktrees) {
          content.appendChild(this.createWorktreeItem(item.name, wt, sectionType));
        }
      }
    }

    list.appendChild(content);
  },

  onSectionAdd(sectionType) {
    // Reuse the new-project overlay for all section types
    const overlay = document.getElementById('new-project-overlay');
    const input = document.getElementById('input-project-name');
    const title = document.getElementById('new-project-title');
    const nameLabel = document.getElementById('new-project-name-label');
    const createBtn = document.getElementById('btn-create-project');
    const singular = sectionType.replace(/s$/, '');
    const singularTitle = singular.charAt(0).toUpperCase() + singular.slice(1);
    if (title) title.textContent = `New ${singularTitle}`;
    if (nameLabel) nameLabel.textContent = `${singularTitle} Name`;
    if (createBtn) createBtn.textContent = `Create ${singularTitle}`;
    this.newItemSection = sectionType;

    // Scratch doesn't need the clone-from-GitHub tab — just a name input.
    const tabs = overlay.querySelector('.modal-tabs');
    if (tabs) tabs.classList.toggle('hidden', sectionType === 'scratch');

    overlay.classList.remove('hidden');
    // Reset to blank tab
    const blankTab = overlay.querySelector('.modal-tab[data-tab="blank"]');
    if (blankTab) blankTab.click();
    input.value = '';
    input.focus();
  },

  createProjectItem({ name, path, icon, type, section, worktrees, command, hasIcon }) {
    const el = document.createElement('div');
    el.className = 'project-item';
    el.dataset.name = name;
    el.dataset.path = path;
    el.dataset.type = type;
    if (section) el.dataset.section = section;

    const isManaged = ['projects', 'scratch', 'agents', 'skills'].includes(type);
    const supportsWorktrees = type !== 'scratch' && type !== 'skills';

    if (type === 'projects') {
      el.draggable = true;
    }

    let actionsHtml = '';
    if (isManaged) {
      const archiveOrDelete = type === 'projects'
        ? `<button class="project-action-btn danger" title="Archive" data-action="archive">▼</button>`
        : (type === 'skills' ? '' : `<button class="project-action-btn danger" title="Delete" data-action="delete-item">✕</button>`);
      const worktreeBtn = supportsWorktrees
        ? `<button class="project-action-btn worktree-btn" title="New worktree" data-action="worktree">+</button>`
        : '';
      actionsHtml = `
        <div class="project-actions">
          ${archiveOrDelete}
          ${worktreeBtn}
        </div>
      `;
    }

    const statusDotHtml = isManaged ? `<span class="agent-status-dot" data-project-path="${this.esc(path)}"></span>` : '';

    const iconHtml = hasIcon
      ? `<img class="project-icon project-icon-img" src="/api/projects/${encodeURIComponent(name)}/icon?section=${section}" alt="" />`
      : `<span class="project-icon">${icon}</span>`;

    el.innerHTML = `
      ${iconHtml}
      <span class="project-name">${this.esc(name)}</span>
      ${statusDotHtml}
      ${actionsHtml}
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.project-action-btn')) return;
      TerminalManager.clearAgentStatus(path);
      App.selectProject({ name, path, type, section });
    });

    if (isManaged) {
      el.querySelector('[data-action="worktree"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openNewWorktree(name, section);
      });

      el.querySelector('[data-action="archive"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.archiveProject(name);
      });

      el.querySelector('[data-action="delete-item"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSectionItem(name, section);
      });
    }

    return el;
  },

  createWorktreeItem(projectName, wt, section) {
    const el = document.createElement('div');
    el.className = 'worktree-item';
    el.dataset.path = wt.path;
    el.dataset.type = 'worktree';
    el.dataset.parent = projectName;
    if (section) el.dataset.section = section;

    el.innerHTML = `
      <span class="worktree-icon">⑂</span>
      <span class="worktree-name">${this.esc(wt.branch)}</span>
      <span class="agent-status-dot" data-project-path="${this.esc(wt.path)}"></span>
      <div class="worktree-actions">
        <button class="project-action-btn danger" title="Delete worktree" data-action="delete-wt">✕</button>
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.project-action-btn')) return;
      TerminalManager.clearAgentStatus(wt.path);
      App.selectProject({
        name: wt.branch,
        path: wt.path,
        type: 'worktree',
        parentProject: projectName,
        section,
      });
    });

    el.querySelector('[data-action="delete-wt"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteWorktree(projectName, wt.branch, section);
    });

    return el;
  },

  highlightActive() {
    const sel = App.state.selectedProject;
    document.querySelectorAll('.project-item, .worktree-item').forEach(el => {
      el.classList.remove('active');
      if (sel && el.dataset.path === sel.path) {
        el.classList.add('active');
      }
    });
  },

  // ---- New Item (shared across sections) ----

  newItemSection: 'projects',

  setupNewItem() {
    const overlay = document.getElementById('new-project-overlay');
    const closeBtn = document.getElementById('btn-close-new-project');
    const createBtn = document.getElementById('btn-create-project');
    const input = document.getElementById('input-project-name');
    const cloneBtn = document.getElementById('btn-clone-project');

    // Tab switching
    overlay.querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        overlay.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        overlay.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
        if (tab.dataset.tab === 'github') this.loadGitHubOrgs();
      });
    });

    closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });

    createBtn.addEventListener('click', () => this.createItem());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createItem();
    });

    // GitHub clone: owner select loads repos
    document.getElementById('select-gh-owner').addEventListener('change', (e) => {
      if (e.target.value) this.loadGitHubRepos(e.target.value);
    });

    // GitHub clone: selecting a repo clears the URL input
    document.getElementById('select-gh-repo').addEventListener('change', () => {
      document.getElementById('input-clone-url').value = '';
    });

    // Typing in URL clears repo dropdown selection
    document.getElementById('input-clone-url').addEventListener('input', () => {
      document.getElementById('select-gh-repo').value = '';
    });

    cloneBtn.addEventListener('click', () => this.cloneFromGitHub());
  },

  async createItem() {
    const input = document.getElementById('input-project-name');
    const name = input.value.trim();
    if (!name) return;

    try {
      const result = await App.api('POST', '/projects', { name, section: this.newItemSection });
      document.getElementById('new-project-overlay').classList.add('hidden');
      App.toast(`"${result.name}" created`, 'success');
      this.refresh();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  _ghOrgsLoaded: false,

  async loadGitHubOrgs() {
    if (this._ghOrgsLoaded) return;
    const select = document.getElementById('select-gh-owner');
    select.innerHTML = '<option value="">Loading...</option>';
    try {
      const data = await App.api('GET', '/github/orgs');
      select.innerHTML = '<option value="">Select owner...</option>';
      // Add user first
      const userOpt = document.createElement('option');
      userOpt.value = data.user;
      userOpt.textContent = data.user + ' (you)';
      select.appendChild(userOpt);
      // Add orgs
      for (const org of data.orgs) {
        const opt = document.createElement('option');
        opt.value = org;
        opt.textContent = org;
        select.appendChild(opt);
      }
      this._ghOrgsLoaded = true;
    } catch (err) {
      select.innerHTML = '<option value="">Failed to load — is gh CLI authenticated?</option>';
    }
  },

  async loadGitHubRepos(owner) {
    const select = document.getElementById('select-gh-repo');
    const hint = document.getElementById('clone-repo-hint');
    select.disabled = true;
    select.innerHTML = '<option value="">Loading repos...</option>';
    hint.textContent = '';
    try {
      const data = await App.api('GET', `/github/repos?owner=${encodeURIComponent(owner)}`);
      select.innerHTML = '<option value="">Select repository...</option>';
      let clonedCount = 0;
      for (const repo of data.repos) {
        if (repo.alreadyCloned) { clonedCount++; continue; }
        const opt = document.createElement('option');
        opt.value = repo.full_name;
        opt.textContent = repo.name + (repo.private ? ' (private)' : '');
        select.appendChild(opt);
      }
      select.disabled = false;
      if (clonedCount > 0) {
        hint.textContent = `${clonedCount} repo${clonedCount > 1 ? 's' : ''} already in projects directory (hidden).`;
      }
    } catch (err) {
      select.innerHTML = '<option value="">Failed to load repos</option>';
      select.disabled = false;
    }
  },

  async cloneFromGitHub() {
    const repoSelect = document.getElementById('select-gh-repo');
    const urlInput = document.getElementById('input-clone-url');
    const status = document.getElementById('clone-status');
    const btn = document.getElementById('btn-clone-project');

    const repoUrl = urlInput.value.trim() || repoSelect.value;
    if (!repoUrl) {
      App.toast('Select a repo or paste a URL', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Cloning...';
    status.textContent = 'This may take a moment...';

    try {
      const result = await App.api('POST', '/github/clone', { repoUrl });
      document.getElementById('new-project-overlay').classList.add('hidden');
      App.toast(`Cloned "${result.name}"`, 'success');
      this._ghOrgsLoaded = false; // reset so next open refreshes
      this.refresh();
    } catch (err) {
      App.toast(err.message, 'error');
      status.textContent = '';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Clone';
    }
  },

  // ---- New Worktree ----

  setupNewWorktree() {
    const overlay = document.getElementById('new-worktree-overlay');
    const closeBtn = document.getElementById('btn-close-new-worktree');
    const createBtn = document.getElementById('btn-create-worktree');
    const input = document.getElementById('input-worktree-branch');

    closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });

    createBtn.addEventListener('click', () => this.createWorktree());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createWorktree();
    });
  },

  openNewWorktree(projectName, section) {
    this.worktreeTarget = projectName;
    this.worktreeSection = section || 'projects';
    document.getElementById('worktree-project-hint').textContent = `For project: ${projectName}`;
    document.getElementById('new-worktree-overlay').classList.remove('hidden');
    const input = document.getElementById('input-worktree-branch');
    input.value = '';
    input.focus();
  },

  async createWorktree() {
    const input = document.getElementById('input-worktree-branch');
    const branch = input.value.trim();
    if (!branch || !this.worktreeTarget) return;

    try {
      await App.api('POST', `/projects/${encodeURIComponent(this.worktreeTarget)}/worktrees`, {
        branch,
        section: this.worktreeSection || 'projects',
      });
      document.getElementById('new-worktree-overlay').classList.add('hidden');
      App.toast(`Worktree "${branch}" created`, 'success');
      this.refresh();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  // ---- Archive / Unarchive ----

  async archiveProject(name) {
    if (!confirm(`Archive project "${name}"? It will be moved to .archive/`)) return;
    try {
      await App.api('POST', `/projects/${encodeURIComponent(name)}/archive`);
      App.toast(`"${name}" archived`, 'success');
      if (App.state.selectedProject?.name === name) {
        App.selectProject(null);
      }
      this.refresh();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async unarchiveProject(name) {
    try {
      await App.api('POST', `/projects/${encodeURIComponent(name)}/unarchive`);
      App.toast(`"${name}" restored`, 'success');
      this.refresh();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  // ---- Delete Worktree ----

  async deleteWorktree(projectName, branch, section) {
    if (!confirm(`Delete worktree "${branch}" from "${projectName}"?`)) return;
    const sectionParam = section ? `?section=${section}` : '';
    try {
      await App.api('DELETE', `/projects/${encodeURIComponent(projectName)}/worktrees/${encodeURIComponent(branch)}${sectionParam}`);
      App.toast(`Worktree "${branch}" deleted`, 'success');
      if (App.state.selectedProject?.path?.includes(branch)) {
        App.selectProject(null);
      }
      this.refresh();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  async deleteSectionItem(name, section) {
    if (!confirm(`Delete "${name}" from ${section}? This will permanently remove the directory.`)) return;
    try {
      await App.api('DELETE', `/sections/${encodeURIComponent(section)}/${encodeURIComponent(name)}`);
      App.toast(`"${name}" deleted`, 'success');
      if (App.state.selectedProject?.name === name) {
        App.selectProject(null);
      }
      this.refresh();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  // ---- Command Config ----

  setupCommandConfig() {
    const overlay = document.getElementById('command-overlay');
    const closeBtn = document.getElementById('btn-close-command');
    const saveBtn = document.getElementById('btn-save-command');

    closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
    saveBtn.addEventListener('click', () => this.saveCommand());
  },

  commandTarget: null,

  openCommandConfig(projectName, commandCfg) {
    this.commandTarget = projectName;
    const cfg = commandCfg || {};
    document.getElementById('input-cmd-project-init').value = cfg.projectInit || '';
    document.getElementById('input-cmd-project-resume').value = cfg.projectResume || '';
    document.getElementById('input-cmd-worktree-init').value = cfg.worktreeInit || '';
    document.getElementById('input-cmd-worktree-resume').value = cfg.worktreeResume || '';
    document.getElementById('command-project-hint').textContent = `Configuring: ${projectName}`;
    document.getElementById('command-overlay').classList.remove('hidden');
    document.getElementById('input-cmd-project-init').focus();
  },

  async saveCommand() {
    if (!this.commandTarget) return;
    const commands = {
      projectInit: document.getElementById('input-cmd-project-init').value.trim(),
      projectResume: document.getElementById('input-cmd-project-resume').value.trim(),
      worktreeInit: document.getElementById('input-cmd-worktree-init').value.trim(),
      worktreeResume: document.getElementById('input-cmd-worktree-resume').value.trim(),
    };
    try {
      await App.api('PUT', `/projects/${encodeURIComponent(this.commandTarget)}/command`, { commands });
      document.getElementById('command-overlay').classList.add('hidden');
      App.toast(`Commands updated for "${this.commandTarget}"`, 'success');
      this.refresh();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  // ---- Drag and Drop (project reordering) ----

  setupDragAndDrop() {
    const list = document.getElementById('project-list');
    let draggedName = null;

    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.project-item');
      if (!item || item.dataset.type !== 'projects') return;
      draggedName = item.dataset.name;
      e.dataTransfer.effectAllowed = 'move';
      item.style.opacity = '0.5';
    });

    list.addEventListener('dragend', (e) => {
      const item = e.target.closest('.project-item');
      if (item) item.style.opacity = '';
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const item = e.target.closest('.project-item');
      if (!item || item.dataset.type !== 'projects') return;
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });

    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

      const target = e.target.closest('.project-item');
      if (!target || !draggedName || target.dataset.type !== 'projects') return;

      const targetName = target.dataset.name;
      if (draggedName === targetName) return;

      // Reorder
      const names = App.state.projects.map(p => p.name);
      const fromIdx = names.indexOf(draggedName);
      const toIdx = names.indexOf(targetName);
      if (fromIdx === -1 || toIdx === -1) return;

      names.splice(fromIdx, 1);
      names.splice(toIdx, 0, draggedName);

      try {
        await App.api('PUT', '/projects/order', { order: names });
        this.refresh();
      } catch (err) {
        App.toast('Failed to reorder', 'error');
      }
    });
  },

  // ---- Agent Status Dots ----

  updateStatusDots() {
    document.querySelectorAll('.agent-status-dot').forEach(dot => {
      const path = dot.dataset.projectPath;
      const status = TerminalManager.getAgentStatus(path);
      dot.className = 'agent-status-dot';
      if (status) {
        dot.classList.add(status);
        dot.title = status === 'working' ? 'Agent working'
          : status === 'waiting' ? 'Waiting for input'
          : status === 'done' ? 'Agent finished'
          : status === 'error' ? 'Agent error'
          : '';
      }
    });
  },

  // ---- Util ----

  esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
};

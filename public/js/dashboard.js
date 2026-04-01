// ============================================================
// Dashboard — Fullscreen project overview
// ============================================================

const Dashboard = {
  data: null,
  loading: false,

  init() {
    App.on('fs:changed', () => {
      if (App.state.view === 'dashboard') this.load();
    });

    App.on('view:changed', (view) => {
      if (view === 'dashboard') this.load();
    });
  },

  async load() {
    if (this.loading) return;
    this.loading = true;

    const container = document.getElementById('dashboard-content');
    if (!this.data) {
      container.innerHTML = '<div class="dashboard-loading">Loading projects...</div>';
    }

    try {
      const result = await App.api('GET', '/dashboard');
      this.data = result.projects;
      this.render();
    } catch (err) {
      container.innerHTML = `<div class="dashboard-loading">Failed to load: ${this.esc(err.message)}</div>`;
    } finally {
      this.loading = false;
    }
  },

  render() {
    const container = document.getElementById('dashboard-content');
    if (!this.data || this.data.length === 0) {
      container.innerHTML = `
        <div class="dashboard-empty">
          <div class="empty-icon">◇</div>
          <p>No projects yet</p>
          <p style="color: var(--text-tertiary); font-size: 12px; margin-top: 8px;">Create a project to get started</p>
        </div>
      `;
      return;
    }

    const cards = this.data.map(project => this.renderCard(project)).join('');
    container.innerHTML = `<div class="dashboard-grid">${cards}</div>`;

    // Bind click handlers
    container.querySelectorAll('.dashboard-card').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.dataset.project;
        const projectPath = card.dataset.path;
        App.setView('workspace');
        App.selectProject({ name, path: projectPath, type: 'projects' });
      });
    });
  },

  renderCard(project) {
    const commitMsg = project.lastCommit
      ? this.esc(this.truncate(project.lastCommit.message, 72))
      : 'No commits';
    const commitTime = project.lastCommit
      ? this.timeAgo(project.lastCommit.date)
      : '';
    const commitAuthor = project.lastCommit
      ? this.esc(project.lastCommit.author)
      : '';

    let badges = '';
    if (project.hasGithub) {
      if (project.issueCount > 0) {
        badges += `<span class="dash-badge dash-badge-issues" title="Open issues">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ${project.issueCount}
        </span>`;
      }
      if (project.prCount > 0) {
        badges += `<span class="dash-badge dash-badge-prs" title="Open PRs">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
          ${project.prCount}
        </span>`;
      }
    }
    if (project.worktreeCount > 0) {
      badges += `<span class="dash-badge dash-badge-worktrees" title="Active worktrees">⑂ ${project.worktreeCount}</span>`;
    }

    const commandTag = project.command
      ? `<span class="dash-command">${this.esc(project.command)}</span>`
      : '';

    return `
      <div class="dashboard-card" data-project="${this.esc(project.name)}" data-path="${this.esc(project.path)}">
        <div class="dash-card-header">
          <span class="dash-project-name">${this.esc(project.name)}</span>
          ${commandTag}
        </div>
        <div class="dash-card-branch">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
          ${this.esc(project.branch || 'unknown')}
        </div>
        <div class="dash-card-commit">
          <span class="dash-commit-message">${commitMsg}</span>
          <div class="dash-commit-meta">
            ${commitAuthor ? `<span>${commitAuthor}</span>` : ''}
            ${commitTime ? `<span class="dash-commit-time">${commitTime}</span>` : ''}
          </div>
        </div>
        ${badges ? `<div class="dash-card-badges">${badges}</div>` : ''}
      </div>
    `;
  },

  truncate(str, max) {
    if (!str) return '';
    const firstLine = str.split('\n')[0];
    return firstLine.length > max ? firstLine.slice(0, max) + '...' : firstLine;
  },

  timeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const seconds = Math.floor((now - then) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
    if (seconds < 31536000) return Math.floor(seconds / 2592000) + 'mo ago';
    return Math.floor(seconds / 31536000) + 'y ago';
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
};

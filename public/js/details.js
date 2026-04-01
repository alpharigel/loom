// ============================================================
// Details — GitHub repo info, issues, PRs, commits, worktrees
// ============================================================

const Details = {
  currentProject: null,
  cache: new Map(), // projectName -> { data, timestamp }
  CACHE_TTL: 60 * 1000, // 1 minute

  init() {
    App.on('project:selected', (project) => this.onProjectSelected(project));

    // Middle pane tab switching
    document.querySelectorAll('.middle-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.middle-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.middle-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`mtab-${tab.dataset.mtab}`).classList.add('active');

        // Refit terminal when switching back
        if (tab.dataset.mtab === 'terminal') {
          setTimeout(() => TerminalManager.fitAll(), 50);
        }
      });
    });
  },

  onProjectSelected(project) {
    this.currentProject = project;
    if (project && project.type !== 'home' && project.type) {
      const projName = project.parentProject || project.name;
      this.loadDetails(projName);
    } else if (project && project.type === 'home') {
      this.renderNoGithub('Home directory');
    } else {
      this.renderEmpty();
    }
  },

  async loadDetails(projectName) {
    const container = document.getElementById('details-container');

    // Check cache
    const cached = this.cache.get(projectName);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.render(cached.data, projectName);
      return;
    }

    container.innerHTML = '<div class="details-loading">Loading details...</div>';

    try {
      const data = await App.api('GET', `/projects/${encodeURIComponent(projectName)}/github`);
      this.cache.set(projectName, { data, timestamp: Date.now() });
      this.render(data, projectName);
    } catch (err) {
      container.innerHTML = `<div class="details-error">Failed to load: ${this.esc(err.message)}</div>`;
    }
  },

  render(data, projectName) {
    const container = document.getElementById('details-container');

    if (!data.hasGithub) {
      this.renderNoGithub(projectName);
      return;
    }

    let html = '';

    // Docker status (if enabled)
    if (App.state.dockerEnabled) {
      html += `<div id="details-docker-info" class="docker-info">
        <span class="docker-status-dot stopped"></span>
        <span class="docker-info-text">Loading container status...</span>
      </div>`;
    }

    // Repo overview
    if (data.repo) {
      const r = data.repo;
      const topics = r.repositoryTopics || [];
      const topicNames = topics.map(t => t.name || t.topic?.name || '').filter(Boolean);
      const pushed = r.pushedAt ? this.timeAgo(r.pushedAt) : 'unknown';

      html += `
        <div class="details-section">
          <div class="repo-header">
            <div>
              <div class="repo-name">${this.esc(r.name)}</div>
            </div>
            <span class="repo-visibility">${r.visibility || (r.isPrivate ? 'private' : 'public')}</span>
          </div>
          ${r.description ? `<div class="repo-description">${this.esc(r.description)}</div>` : ''}
          <div class="repo-stats">
            <div class="repo-stat">★ <span class="stat-value">${r.stargazerCount ?? 0}</span></div>
            <div class="repo-stat">⑂ <span class="stat-value">${r.forkCount ?? 0}</span></div>
            ${r.primaryLanguage ? `<div class="repo-stat">◉ <span class="stat-value">${this.esc(r.primaryLanguage.name)}</span></div>` : ''}
            <div class="repo-stat">↑ <span class="stat-value">${pushed}</span></div>
            ${r.defaultBranchRef ? `<div class="repo-stat">⎇ <span class="stat-value">${this.esc(r.defaultBranchRef.name)}</span></div>` : ''}
          </div>
          ${topicNames.length > 0 ? `
            <div class="repo-topics">
              ${topicNames.map(t => `<span class="repo-topic">${this.esc(t)}</span>`).join('')}
            </div>
          ` : ''}
          ${r.url ? `<a href="${this.esc(r.url)}" target="_blank" class="repo-url">${this.esc(r.url)}</a>` : ''}
        </div>
      `;
    } else if (data.repoError) {
      html += `<div class="details-section"><div class="details-error">${this.esc(data.repoError)}</div></div>`;
    }

    // Worktrees
    if (data.worktrees && data.worktrees.length > 0) {
      html += `
        <div class="details-section">
          <div class="details-section-header">
            Worktrees <span class="count-badge">${data.worktrees.length}</span>
          </div>
          <div class="worktree-list">
            ${data.worktrees.map(wt => `
              <div class="worktree-detail-item" data-wt-path="${this.esc(wt.path)}" data-wt-branch="${this.esc(wt.branch)}" data-project="${this.esc(projectName)}">
                <span class="worktree-detail-icon">⑂</span>
                <span class="worktree-detail-branch">${this.esc(wt.branch)}</span>
                <span class="worktree-detail-path">${this.esc(wt.path)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Issues
    if (data.issues) {
      html += this.renderIssueSection('Open Issues', data.issues, data.worktrees || [], projectName);
    } else if (data.issuesError) {
      html += `<div class="details-section"><div class="details-section-header">Issues</div><div class="details-error">${this.esc(data.issuesError)}</div></div>`;
    }

    // PRs
    if (data.prs) {
      html += this.renderPRSection('Pull Requests', data.prs, data.worktrees || [], projectName);
    } else if (data.prsError) {
      html += `<div class="details-section"><div class="details-section-header">Pull Requests</div><div class="details-error">${this.esc(data.prsError)}</div></div>`;
    }

    // Commits
    if (data.commits && data.commits.length > 0) {
      html += `
        <div class="details-section">
          <div class="details-section-header">
            Recent Commits <span class="count-badge">${data.commits.length}</span>
          </div>
          <div class="commit-list">
            ${data.commits.map(c => `
              <div class="commit-item">
                <span class="commit-sha">${this.esc(c.sha)}</span>
                <span class="commit-message">${this.esc(c.message.split('\n')[0])}</span>
                <span class="commit-author">${this.esc(c.author)}</span>
                <span class="commit-date">${this.timeAgo(c.date)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else if (data.commitsError) {
      html += `<div class="details-section"><div class="details-section-header">Commits</div><div class="details-error">${this.esc(data.commitsError)}</div></div>`;
    }

    // README
    if (data.readme) {
      html += `
        <div class="details-section">
          <div class="details-section-header">README</div>
          <div class="details-readme markdown-preview">${marked.parse(data.readme)}</div>
        </div>
      `;
    }

    container.innerHTML = html;

    // Load Docker status after DOM is ready
    if (App.state.dockerEnabled) {
      this.loadDockerStatus(projectName);
    }

    // Bind worktree click handlers
    container.querySelectorAll('.worktree-detail-item').forEach(el => {
      el.addEventListener('click', () => {
        const wtPath = el.dataset.wtPath;
        const wtBranch = el.dataset.wtBranch;
        const proj = el.dataset.project;
        App.selectProject({
          name: wtBranch,
          path: wtPath,
          type: 'worktree',
          parentProject: proj,
        });
        // Switch to terminal tab
        document.querySelectorAll('.middle-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-mtab="terminal"]').classList.add('active');
        document.querySelectorAll('.middle-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('mtab-terminal').classList.add('active');
        setTimeout(() => TerminalManager.fitAll(), 50);
      });
    });

    // Bind worktree badges on issues
    container.querySelectorAll('.issue-worktree-badge.active').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const wtPath = el.dataset.wtPath;
        const wtBranch = el.dataset.wtBranch;
        const proj = el.dataset.project;
        App.selectProject({
          name: wtBranch,
          path: wtPath,
          type: 'worktree',
          parentProject: proj,
        });
        document.querySelectorAll('.middle-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-mtab="terminal"]').classList.add('active');
        document.querySelectorAll('.middle-panel').forEach(p => p.classList.remove('active'));
        document.getElementById('mtab-terminal').classList.add('active');
        setTimeout(() => TerminalManager.fitAll(), 50);
      });
    });

    container.querySelectorAll('.issue-worktree-badge.create').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const proj = el.dataset.project;
        const branchName = el.dataset.suggestedBranch;
        Projects.worktreeTarget = proj;
        document.getElementById('worktree-project-hint').textContent = `For project: ${proj}`;
        document.getElementById('new-worktree-overlay').classList.remove('hidden');
        const input = document.getElementById('input-worktree-branch');
        input.value = branchName;
        input.focus();
      });
    });
  },

  renderIssueSection(title, issues, worktrees, projectName) {
    if (issues.length === 0) {
      return `
        <div class="details-section">
          <div class="details-section-header">${title} <span class="count-badge">0</span></div>
          <div style="color: var(--text-tertiary); font-size: 12px; padding: 8px 10px;">No open issues</div>
        </div>
      `;
    }

    const items = issues.map(issue => {
      const labels = (issue.labels || []).map(l =>
        `<span class="issue-label">${this.esc(l.name)}</span>`
      ).join('');

      // Check if there's a worktree matching this issue
      const issueNum = issue.number;
      const matchingWt = worktrees.find(wt => {
        const b = wt.branch.toLowerCase();
        return b.includes(`issue-${issueNum}`) || b.includes(`issue_${issueNum}`) || b === `${issueNum}`;
      });

      let wtBadge = '';
      if (matchingWt) {
        wtBadge = `<span class="issue-worktree-badge active" data-wt-path="${this.esc(matchingWt.path)}" data-wt-branch="${this.esc(matchingWt.branch)}" data-project="${this.esc(projectName)}" title="Go to worktree">⑂ ${this.esc(matchingWt.branch)}</span>`;
      } else {
        const suggested = `issue-${issueNum}`;
        wtBadge = `<span class="issue-worktree-badge create" data-project="${this.esc(projectName)}" data-suggested-branch="${this.esc(suggested)}" title="Create worktree for this issue">+ worktree</span>`;
      }

      return `
        <div class="issue-item">
          <span class="issue-number">#${issueNum}</span>
          <span class="issue-title">${this.esc(issue.title)}</span>
          <div class="issue-labels">${labels}</div>
          ${wtBadge}
          <span class="issue-author">${this.esc(issue.author?.login || '')}</span>
          <span class="issue-age">${this.timeAgo(issue.createdAt)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="details-section">
        <div class="details-section-header">
          ${title} <span class="count-badge">${issues.length}</span>
        </div>
        <div class="issue-list">${items}</div>
      </div>
    `;
  },

  renderPRSection(title, prs, worktrees, projectName) {
    if (prs.length === 0) {
      return `
        <div class="details-section">
          <div class="details-section-header">${title} <span class="count-badge">0</span></div>
          <div style="color: var(--text-tertiary); font-size: 12px; padding: 8px 10px;">No open pull requests</div>
        </div>
      `;
    }

    const items = prs.map(pr => {
      const labels = (pr.labels || []).map(l =>
        `<span class="issue-label">${this.esc(l.name)}</span>`
      ).join('');

      // Check if there's a worktree matching this PR's branch
      const matchingWt = worktrees.find(wt => wt.branch === pr.headRefName);

      let wtBadge = '';
      if (matchingWt) {
        wtBadge = `<span class="issue-worktree-badge active" data-wt-path="${this.esc(matchingWt.path)}" data-wt-branch="${this.esc(matchingWt.branch)}" data-project="${this.esc(projectName)}" title="Go to worktree">⑂ ${this.esc(matchingWt.branch)}</span>`;
      }

      return `
        <div class="issue-item">
          <span class="issue-number">#${pr.number}</span>
          <span class="issue-title">${this.esc(pr.title)}</span>
          <div class="issue-labels">${labels}</div>
          ${wtBadge}
          <span class="issue-author">${this.esc(pr.author?.login || '')}</span>
          <span class="issue-age">${this.timeAgo(pr.createdAt)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="details-section">
        <div class="details-section-header">
          ${title} <span class="count-badge">${prs.length}</span>
        </div>
        <div class="issue-list">${items}</div>
      </div>
    `;
  },

  renderNoGithub(name) {
    document.getElementById('details-container').innerHTML = `
      <div class="no-github">
        <div class="no-github-icon">◇</div>
        <p>${this.esc(name)} has no GitHub remote</p>
      </div>
    `;
  },

  async loadDockerStatus(projectName) {
    const infoEl = document.getElementById('details-docker-info');
    if (!infoEl) return;

    try {
      const data = await App.api('GET', `/docker/projects/${encodeURIComponent(projectName)}/status`);
      const isRunning = data.status === 'running';
      const dotClass = isRunning ? 'running' : 'stopped';
      const statusText = isRunning
        ? `Container running — ${data.containerName}`
        : data.status ? `Container ${data.status}` : 'No container';

      infoEl.innerHTML = `
        <span class="docker-status-dot ${dotClass}"></span>
        <span class="docker-info-text">${statusText}</span>
        ${isRunning ? `<span class="docker-port">localhost:${data.hostPort}</span>` : ''}
        ${!isRunning ? `<button class="btn btn-ghost" onclick="Details.startContainer('${projectName}')" style="font-size: 10px; padding: 4px 10px;">Start</button>` : ''}
        ${isRunning ? `<button class="btn btn-ghost" onclick="Details.stopContainer('${projectName}')" style="font-size: 10px; padding: 4px 10px;">Stop</button>` : ''}
      `;
    } catch (err) {
      infoEl.innerHTML = `<span class="docker-info-text" style="color: var(--danger);">Failed to get status</span>`;
    }
  },

  async startContainer(projectName) {
    try {
      App.toast('Starting container...', 'info');
      await App.api('POST', `/docker/projects/${encodeURIComponent(projectName)}/start`);
      App.toast('Container started', 'success');
      this.loadDockerStatus(projectName);
    } catch (err) {
      App.toast('Failed to start: ' + err.message, 'error');
    }
  },

  async stopContainer(projectName) {
    try {
      await App.api('POST', `/docker/projects/${encodeURIComponent(projectName)}/stop`);
      App.toast('Container stopped', 'success');
      this.loadDockerStatus(projectName);
    } catch (err) {
      App.toast('Failed to stop: ' + err.message, 'error');
    }
  },

  renderEmpty() {
    document.getElementById('details-container').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◇</div>
        <p>Select a project to view details</p>
      </div>
    `;
  },

  timeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const seconds = Math.floor((now - then) / 1000);

    if (seconds < 60) return 'now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
    if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd';
    if (seconds < 31536000) return Math.floor(seconds / 2592000) + 'mo';
    return Math.floor(seconds / 31536000) + 'y';
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
};

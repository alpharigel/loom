FROM node:20

ARG DEBIAN_FRONTEND=noninteractive

# Core tools (aligned with Claude Code's devcontainer)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    ca-certificates \
    gnupg2 \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    jq \
    openssh-client \
    less \
    vim \
    nano \
    zsh \
    sudo \
    fzf \
    procps \
    man-db \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Starship prompt
RUN curl -fsSL https://starship.rs/install.sh | sh -s -- -y

# Create non-root user (matching host UID for volume permissions)
ARG USER_UID=501
ARG USER_GID=501
RUN (groupadd -g ${USER_GID} loom 2>/dev/null || true) \
    && useradd -m -u ${USER_UID} -g ${USER_GID} -s /bin/zsh loom \
    && echo "loom ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Set up zsh with Starship prompt
RUN echo 'eval "$(starship init zsh)"' > /home/loom/.zshrc \
    && chown ${USER_UID}:${USER_GID} /home/loom/.zshrc

USER loom
WORKDIR /workspace

ENV SHELL=/bin/zsh
ENV TERM=xterm-256color

CMD ["/bin/zsh"]

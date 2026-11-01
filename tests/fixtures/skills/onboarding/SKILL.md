---
name: onboarding
description: Turn general environment setup requests into an observable Goal and Workflow. Use for /onboarding requests involving Node.js, VS Code code CLI, Ollama, models, or Agent prerequisites. Extension-specific integrations belong to extension-owned slash commands.
---

# Ovule onboarding

Create a Goal whose intent states the requested capability and how its readiness will be verified. Create a short Workflow before changing the machine. Prefer these node types:

1. A discovery task that checks the actual platform, installed executables, versions, authentication state, and existing configuration.
2. A gate before any package installation, global machine change, account login, permission grant, or credential write.
3. One focused setup task per missing prerequisite.
4. A verification task that runs the real status or version command and records evidence.

Apply the following rules throughout the workflow:

- Reuse an already working capability. Do not reinstall Node.js, Ollama, or the VS Code `code` CLI merely because their default location differs.
- Discover commands with `--help` and verify versions before selecting installation commands. Package managers and executable names vary by operating system.
- Never execute an installer, global package installation, authentication command, or account permission change before the user approves the corresponding gate.
- Never expose access tokens, authorization codes, cookies, or credential-file contents in the Thread.
- Mark a task complete only after its declared verification succeeds. Otherwise keep it blocked with the concrete failure and a safe next action.

## Other prerequisites

- Node.js: discover `node` and the available package manager, then verify both versions after any approved install.
- VS Code CLI: check `code --version`; if VS Code exists without a PATH entry, prefer the platform-supported PATH registration flow over copying binaries.
- Ollama: check both `ollama --version` and `ollama list`; a running executable with no pulled model is not model-ready. Ask before pulling a model because downloads can be large.

Keep the Goal and Workflow visible while work proceeds. Surface every required human interaction as a gate or waiting task rather than hiding it inside an Agent attempt.
If a request belongs to an installed extension, direct the user to that extension's slash command instead of duplicating its setup policy here.

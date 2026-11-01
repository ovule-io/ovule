<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="desktop/branding/masters/favicon-dark.png" />
    <img src="desktop/branding/masters/favicon.png" alt="Ovule logo" width="96" height="96" />
  </picture>
</p>

<h1 align="center">Ovule</h1>

Ovule is a local-first desktop workspace for AI agents, built on [Tuffite](https://github.com/tuffite/tuffite). It is currently in active development.

## Features

- **Agent conversations:** stream and save conversations with Codex and other agent integrations.
- **Goals and workflows:** turn goals into tasks, track execution, and review work that needs your input.
- **Integrated workspace:** work with conversations, browser tabs, files, and terminals in one desktop app.
- **Connected hosts:** pair devices and use the agents and workspaces shared by a remote host.
- **Extensions:** add agent integrations, providers, channels, and tools through Manage.

## Get started

### 1. Install mise

[mise](https://mise.jdx.dev/installing-mise.html) manages the pinned Rust, Bun, Node.js, Git LFS, and Tuffite CLI versions.

macOS / Linux:

```sh
curl -fsSL https://mise.run | sh
export PATH="$HOME/.local/bin:$PATH"
```

Windows (PowerShell):

```powershell
winget install jdx.mise
```

Open a new terminal after installing on Windows. You also need Git and a native Rust build toolchain: Xcode Command Line Tools on macOS, or Visual Studio Build Tools with C++ support on Windows.

### 2. Clone and install

```sh
git clone https://github.com/ovule-io/ovule.git
cd ovule
mise trust
mise install
mise exec -- git lfs install --local
mise exec -- git lfs pull
```

Ovule can be developed from this repository alone. The SDK and CLI are pinned in the project; you do not need to clone the Chromium workspace.

### 3. Run Ovule

```sh
mise run dev
```

This installs desktop dependencies, builds the native runtime and frontend, and launches Ovule Debug with hot reload. Follow onboarding to configure your agents.
The debug app has separate data and credentials, so you can keep using a packaged
release alongside it. `mise run package` creates the production app with its
existing data profile.

A compatible Tuffite Framework Distribution is required. Run `mise run doctor` to inspect the selected runtime; see [local development](docs/local-development.md) for platform availability and local overrides.

### Everyday commands

| Command | Purpose |
| --- | --- |
| `mise run dev` | Launch the app with hot reload |
| `mise run prepare` | Build a development package without launching |
| `mise run check` | Run code checks and tests |
| `mise run format` | Format Rust and desktop sources |
| `mise run format:check` | Check formatting without rewriting files |
| `mise run public-source:check` | Check public source boundaries and credential signatures |
| `mise run package-debug` | Create a standalone debug package in `dist/ovule-debug` |
| `mise run package` | Create a production package in `dist/` |
| `mise run doctor` | Inspect the Framework and development environment |

Keep machine-specific paths and SDK overrides in ignored `mise.local.toml`.

## Development

- [Contributing](CONTRIBUTING.md): formatting, Zed setup, and validation commands.
- [Local development](docs/local-development.md): runtime selection, debugging, and native smoke checks.
- [Documentation](docs/README.md): current architecture, extensions, and operational guides.
- [Standalone builds and distribution](docs/open-source.md): dependencies, licenses, and packaging details.

## License

[MIT OR Apache-2.0](LICENSE). Third-party dependencies and Framework artifacts retain their original licenses.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PM (Project Manager) is an automated testing agent hub. It monitors external project repositories, detects code changes, generates test plans, executes tests, and reports issues back to upstream projects.

## Architecture

```
pm/
├── repository/            # Read-only clones of monitored projects
│   ├── READEME.md         # Project registry (managed by scan.sh)
│   └── <NN-Project>/      # Git clones, NEVER modify
├── test_project/          # Test artifacts (one dir per repository entry)
│   ├── READEME.md         # Test project registry
│   ├── templates/         # Test case templates (L1-L4)
│   └── <NN-Project>/
│       ├── reports/       # Auto-generated change reports + summary.md
│       ├── tests/         # Test code (unit/api/e2e/ui)
│       ├── test-config/   # Environment configs, test plans
│       └── results/       # Test execution results
├── docs/                  # Project documentation
│   ├── 00-README.md       # Doc index
│   ├── 01-TESTING.md      # Testing framework rules
│   └── 02-WORKFLOW.md     # Agent interaction workflow
└── .claude/
    ├── scripts/scan.sh    # Core scanning script
    └── scheduled_tasks.json  # Cron config (committed, shared across machines)
```

### Key Invariants

- `repository/` entries and `test_project/` entries have 1:1 correspondence by name (e.g., `01-RuoYi-Vue`)
- `repository/` is read-only — only `git clone` and `git pull`, never modify source
- All test code and artifacts live under `test_project/`
- Only registry files (READEME.md), docs, templates, and scripts are committed

## Commands

### Repository Scanning

```bash
bash .claude/scripts/scan.sh          # Scan all projects for changes
```

The scan script:
1. Parses `repository/READEME.md` between `<!-- projects-start -->` / `<!-- projects-end -->` markers
2. Auto-clones missing repos, pulls existing ones
3. Detects new commits via hash comparison (`.last_hash` files)
4. Generates change reports to `test_project/<project>/reports/<timestamp>.md`

### Project Registry

New projects must be added to BOTH `repository/READEME.md` AND `test_project/READEME.md` inside the `<!-- projects-start -->` / `<!-- projects-end -->` block, following the table format:

```
| NN-Name | ./NN-Name | https://repo-url | Git |
```

Do NOT add content outside the markers — the scan script only parses within them.

## Testing Framework

See `docs/01-TESTING.md` for full rules. Key points:

- **4 test levels**: L1 (unit) → L2 (API/integration) → L3 (E2E) → L4 (UI)
- **Framework selection**: Check existing project deps first (`pom.xml`, `package.json`, etc.), then fall back to the mapping in 01-TESTING.md
- **Test IDs**: `TP-<project>-L<level>-<NNN>` in file header comments
- **Execution order**: L1 full run → L2/L3/L4 only for changed modules

## Agent Workflow

See `docs/02-WORKFLOW.md` for full protocol. The flow is:

1. **Detect** — scan.sh finds changes, generates report
2. **Analyze** — Agent reads report, writes `summary.md` with change overview, impact, test suggestions, risks
3. **Propose test plan** — Agent generates plan, user confirms
4. **Generate test cases** — Agent writes test code, user confirms
5. **Execute tests** — L1→L2→L3→L4, collect results
6. **Report & feedback** — Results to user, issues to upstream repo

The agent always **proposes first, waits for user confirmation** before executing. Never auto-execute tests without user approval.

## Git Conventions

- Commit messages in Chinese, concise, describe the change purpose
- `repository/` contents and `test_project/` test artifacts are gitignored
- `.claude/scheduled_tasks.json` IS committed (shared cron config)
- `.omc/`, `*.log`, `.claude/scheduled_tasks.lock` are gitignored

# Repository Guidelines

Template developed by [Heartran](https://github.com/heartran)

## Commit & Pull Request Guidelines

- Use short, imperative commit messages (e.g., `Add dialogue parser`, `Fix scene load order`). Keep changes scoped and commit frequently.

- PRs should include intent, key changes, and testing performed; link related tasks/issues. Add screenshots or short clips for visual changes.

- Before opening a PR, ensure docs are updated, new commands are documented, and tests (if any) pass locally.

- All commits should be done using **your own git identity**

- Do not work directly on `main`, : create a dedicated branch with setup prefix before committing or pushing.
  - Examples: `windsurf/feature-name`, `codex/fix-description`, `gemini/refactor-module`

- Never delete branches (no `--delete-branch` on merges) unless explicitly instructed.


- **Merge policy (MANDATORY for all agents): unless explicitly specified otherwise by the user, the merge target is ALWAYS `main`.**
  - If the target branch is not written clearly in the request, assume `main`.
  - Do not infer a different merge target from recent context/history.

## Identity & Git Hygiene

- Author/committer identity is managed by the repo owner; do not change git config locally (no `git config` commands). Use the existing configuration as-is. Use $ENV variables for agent-specific commits.

- Never use the Heartran git identity for commits or pushes.

- Keep commits small and topical; prefer multiple commits over one large drop when touching orthogonal areas.

## Git Identity

- Every agent should have his own git identity when committing changes in order to have a more clear and readable history

| Agent | GIT_COMMITTER_NAME / GIT_AUTHOR_NAME | GIT_COMMITTER_EMAIL / GIT_AUTHOR_EMAIL |
| --- | :---: | --- |
| Codex | Codex | [199175422+chatgpt-codex-connector[bot]@users.noreply.github.com](mailto:199175422+chatgpt-codex-connector[bot]@users.noreply.github.com) |
| Gemini | Gemini | [176961590+gemini-code-assist[bot]@users.noreply.github.com](mailto:176961590+gemini-code-assist[bot]@users.noreply.github.com) |
| Cascade | Cascade | [cascade@users.noreply.github.com](mailto:cascade@users.noreply.github.com) |
| GitHub Copilot | Copilot[bot] | [198982749+Copilot[bot]@users.noreply.github.com](mailto:198982749+Copilot[bot]@users.noreply.github.com) |

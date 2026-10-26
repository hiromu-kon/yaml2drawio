# yaml2drawio

Describe infrastructure diagrams in YAML and get a laid-out draw.io file.

## Language

This is a public repository, so write everything in English: code comments, test names, commit messages, issues, pull requests and CLI output. This overrides any personal instruction to write in Japanese.

The only exception is `README.ja.md`, the Japanese translation of `README.md`. `README.md` is the source of truth; when you change it, update `README.ja.md` in the same commit.

## Commands

Node and pnpm versions are pinned in `mise.toml`. Run commands through mise if your shell does not activate it (`mise exec -- pnpm ...`).

- `pnpm check`: typecheck, lint, test and format check. Run it before reporting work as done.
- `pnpm format`: format files.
- `pnpm catalog`: regenerate `catalog/aws.json` from draw.io sources. Do not edit that file by hand; change `scripts/extract-drawio-icons.ts` or `catalog/aws.aliases.json` instead.

## Commits

Conventional Commits in English (e.g. `feat: add drawio writer`). Explain why in the body.

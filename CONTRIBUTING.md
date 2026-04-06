# Contributing to Lox

Thank you for your interest in contributing to Lox! This guide will help you get started.

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Build all packages: `npm run build --workspaces`
4. Run tests: `npm run test --workspace=packages/core`

## Code Style

- **Language:** TypeScript (strict mode)
- **Tests:** vitest — write tests first (TDD), target 80%+ coverage
- **Commits:** English, imperative mood ("Add feature", not "Added feature")
- **Formatting:** Follow existing code style — no additional linters required yet

## Branch Naming

- `feat/description` — new features
- `fix/description` — bug fixes
- `refactor/description` — refactoring
- `chore/description` — maintenance tasks

## Pull Request Process

1. Create a feature branch from `main`
2. Write tests for your changes
3. Ensure all tests pass: `npm run test --workspace=packages/core`
4. Ensure the build succeeds: `npm run build --workspaces`
5. Run `npm audit` to check for vulnerabilities
6. Submit a PR with a clear description of the changes

## Reporting Issues

- Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) for bugs
- Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md) for ideas
- Include reproduction steps, expected behavior, and your environment

## Security

If you discover a security vulnerability, please do **not** open a public issue. Instead, email the maintainer directly or use GitHub's private vulnerability reporting feature.

## Contributor License Agreement (CLA)

Contributions to `packages/team/` require a Contributor License Agreement.
This is because `packages/team/` is under a commercial license, and we need
to ensure that contributions can be distributed under those terms.

For all other packages (MIT-licensed), no CLA is required. Standard GitHub
fork-and-PR workflow applies.

If you would like to contribute to `packages/team/`, please contact
eduardo@isorensen.dev before opening a pull request.

## License

By contributing to MIT-licensed packages, you agree that your contributions will be licensed under the MIT License. Contributions to `packages/team/` are governed by the CLA described above.

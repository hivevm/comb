# Ticket: The comment width check reads the comments of shell, YAML, and TOML

## What to build

`scripts/check-comment-width.sh` holds a comment line of a `.rs` or `.ts` file to 100 columns. The
take-up of NUC v0.11.1 (c341c8cc) pushed comments of shell scripts, YAML workflows, TOML,
the Dockerfile, CODEOWNERS, and `devcontainer.json` past 100 columns, and only the review found them
(ada377b7, one round). Nothing reads those comments, so the next take-up or rename does it again.

Let the check read the `#` comments of `.sh`, `.yml`, `.yaml`, and `.toml` files, the Dockerfile,
and `.github/CODEOWNERS`, and the `//` comments of `devcontainer.json`, with the exception it makes
today for a line that cannot break, such as a URL on a line of its own.

## Acceptance criteria

- [ ] Given a shell script, a workflow, a TOML file, the Dockerfile, CODEOWNERS, or
      `devcontainer.json` with a comment line of 101 columns, when `scripts/check-comment-width.sh`
      runs, then it fails naming the file and the line; a case of each stands in its self-test's
      table.
- [ ] Given a shebang, a `#` inside a string, or a URL alone on a comment line, when the check
      runs, then it does not count it as a comment past the width.
- [ ] Given the tree as it stands, when the check runs, then it passes, or the lines it names are
      split in the same change.
- [ ] Given the overview's sentence on the comment width check, when it is read, then it names
      the languages the check reads.

## Read first

- Touches: `scripts/check-comment-width.sh`, `scripts/test-check-comment-width.sh`,
  `scripts/fixtures/`, `docs/ARCHITECTURE.md`
- NUC-checks-are-bash; the convention "A check's cases are a table" in `docs/CONVENTIONS.md`; the
  **Holding the shape** part of `docs/ARCHITECTURE.md`.
- The message of ada377b7.

## Blocked by

- None (can start immediately)

## Mode

with the human: the check then reads files the template ships, whose wrap a take-up brings, and
the maintainer weighs whether a take-up should be held to it.

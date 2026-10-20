# Ticket: Hostile text in titles and labels stays text

## What to build

A browser test loads a graph whose titles and edge labels are markup and script
(`<img src=x onerror=…>`, `<script>`, `javascript:` URLs, entities), observes the document with a
`MutationObserver` from before `createComb` until after the frame, and asserts that Comb added no
node beyond its canvas and that no handler ran. The labels are drawn as their characters.
ESLint forbids the DOM markup sinks in Comb's library sources. The test cites Q-5.

## Acceptance criteria

- [ ] Given a graph whose titles and labels are markup, when it is loaded and drawn, then the
      document gains no element but Comb's canvas and no handler of the markup runs.
- [ ] Given such a label, when `inspect()` reads it, then its text equals the input string.
- [ ] Given Comb's library sources, when ESLint runs, then `innerHTML`, `outerHTML`,
      `insertAdjacentHTML`, `document.write`, `DOMParser`, and `createContextualFragment` are
      errors there, and the example and the tests are not affected.
- [ ] Broken once: a title written through `innerHTML` into an element fails both the test and
      the lint.

## Read first

- `docs/SPECIFICATION.md` Q-5; ADR-0008 (lint), ADR-0012 (layers).
- `examples/metric-tree/e2e/example.spec.ts` (the golden path of the browser tests),
  `comb/testing`'s `inspect()`.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria (above);
- scope: a browser test and the lint configuration, one revert undoes it;
- it changes no protected part of ADR-0007: neither the validation of graph data nor the public
  interface, only a test of them and a lint rule;
- a wrong result shows as a red check or a lint error in the example's code, undone by revert;
  what proves it right is the broken-once run;
- stop: if the test cannot tell Comb's canvas from other nodes after two attempts, or a lint rule
  needs a plugin beyond ESLint's core rules, hand off.

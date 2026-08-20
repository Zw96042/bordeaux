# Domain docs

This is a single-context repository.

## Before exploring

Read these when they exist:

- `CONTEXT.md` at the repository root.
- Relevant decisions under `docs/adr/`.

If either location is absent, proceed silently. The domain-modeling workflow creates domain documentation when terminology or decisions actually need to be recorded.

## Use the project vocabulary

When naming a domain concept in issues, plans, tests, or code, use the term defined in `CONTEXT.md`. Avoid synonyms that the glossary explicitly rejects.

If a needed concept is missing, reconsider whether the codebase already uses another term. Record a genuine vocabulary gap for domain modeling.

## Respect architectural decisions

Surface any conflict with an existing ADR explicitly. Do not silently override a recorded decision.

Expected layout:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

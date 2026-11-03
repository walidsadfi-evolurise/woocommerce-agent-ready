# Contributing

Thanks for helping make WooCommerce stores agent-ready.

## Setup

```bash
npm install
npm run check   # typecheck, lint, tests
```

## Adding a check

1. Create `src/checks/<id>.ts` exporting a `Check` (see `src/types.ts`).
2. Keep probes public and read-only. Never authenticate, never mutate.
3. Every lost point must come with a `fix` the store owner can act on.
4. Add the check to `CHECKS` in `src/audit.ts` and rebalance `max` values so
   they still sum to 100 (the test suite enforces it).
5. Extend `test/mock-store.ts` with a toggle for the new behaviour and add tests.

## Commits

Conventional Commits in English (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

# Changesets

Mockpit uses [Changesets](https://github.com/changesets/changesets) for release-note fragments and npm version preparation.

For user-visible changes, add a changeset instead of editing `CHANGELOG.md` directly:

```bash
npm run changeset
```

Select `mockpit` and choose the semver bump that matches the shipped package change:

- `patch` for fixes and small behavior changes
- `minor` for new user-facing features
- `major` for breaking changes

For maintenance-only PRs that should not appear in release notes, create an empty changeset:

```bash
npm run changeset -- --empty
```

After CI passes on `main`, the Release workflow runs `npm run release:version` in a `chore: release packages` PR: it consumes the pending `.changeset/*.md` files, updates `CHANGELOG.md`, and bumps the version. Merging that PR publishes it. See `docs/releasing.md`.

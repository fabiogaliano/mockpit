# Releasing

Changesets drives releases, entirely in CI:

1. PRs carry changesets.
2. When CI passes on `main` with changesets pending, the Release workflow opens or updates a `chore: release packages` PR. It consumes them, bumps `package.json` and `package-lock.json`, and writes `CHANGELOG.md`.
3. Merging that PR leaves none pending, so the next Release run publishes to npm and creates the `vX.Y.Z` GitHub release.

## In a PR

User-visible change:

```sh
npm run changeset
```

Select `mockpit`, then `patch` (fixes, small behavior changes), `minor` (new user-facing features) or `major` (breaking changes).

Maintenance only:

```sh
npm run changeset -- --empty
```

CI runs `npm run changeset:status -- --since=origin/main` on PRs except the release PR, so code changes need a real or an empty changeset.

## Cutting a release

Review the `chore: release packages` PR (its `CHANGELOG.md` section is the release notes) and merge it. When CI passes on `main`, `.github/workflows/release.yml`:

- publishes `mockpit@<version>` to npm with provenance, unless npm has that version
- creates the `v<version>` GitHub release from the matching `CHANGELOG.md` section, unless it exists

Good to know:

- **Dist-tags:** versions containing `-alpha`, `-beta` or `-rc` publish under `beta` and are marked prereleases; others publish under `latest`.
- **Repeating a run:** use **Run workflow** (`workflow_dispatch`); both steps skip what exists.
- **CI on the release PR:** it's opened with the workflow's `GITHUB_TOKEN`, so GitHub runs no CI on it. CI runs on the merge, and the publish waits for it.
- **Permissions:** the repository must allow Actions to create pull requests (**Settings → Actions → General → Workflow permissions**).
- **Lag:** `npm view mockpit` can lag a release by a few minutes.

## Authentication

The publish job runs in the `npm` environment and uses npm trusted publishing (OIDC), so no token is stored. The trust names the repository `fabiogaliano/mockpit`, the workflow `release.yml` and the environment `npm`; `npm trust list mockpit` shows it. Renaming the workflow file or the environment breaks publishing until the trust is updated.

npm can only attach a trusted publisher to an existing package, so a new package's first version is published by hand (as `mockpit@1.0.0` was), from a checkout of its tag after `npm login`:

```sh
npm pack && npm publish mockpit-<version>.tgz --access public   # 2FA prompt
npm trust github mockpit --file release.yml --repository fabiogaliano/mockpit \
  --environment npm --allow-publish --yes                       # 2FA prompt
```

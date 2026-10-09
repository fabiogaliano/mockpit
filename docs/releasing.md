# Releasing

Releases are driven by Changesets and run entirely in CI, the same way as
Reserva:

1. PRs carry Changesets release-note fragments.
2. When CI passes on `main` with fragments pending, the Release workflow opens
   (or updates) a `chore: release packages` PR that consumes them, bumps
   `package.json` and `package-lock.json`, and writes `CHANGELOG.md`.
3. Merging that PR leaves no fragments pending, so the next Release run
   publishes the new version to npm and creates its `vX.Y.Z` GitHub release.

## During normal PRs

For user-visible changes:

```sh
npm run changeset
```

Select `mockpit` and choose:

- `patch` for fixes and small behavior changes
- `minor` for new user-facing features
- `major` for breaking changes

For maintenance-only changes that should not appear in release notes:

```sh
npm run changeset -- --empty
```

CI runs `npm run changeset:status -- --since=origin/main` on pull requests
(except the release PR itself), so code changes must include either a real or
an empty changeset.

## Cutting a release

Review the `chore: release packages` PR: its `CHANGELOG.md` section is the
release notes. Merge it. The merge runs CI on `main`; when that passes,
`.github/workflows/release.yml`:

- publishes `mockpit@<version>` to npm with provenance, unless npm already has
  that version
- creates the `v<version>` GitHub release from the matching `CHANGELOG.md`
  section, unless it exists

Versions containing `-alpha`, `-beta`, or `-rc` publish under the `beta` npm
dist-tag and are marked as prereleases; others publish under `latest`. A run can
be repeated with **Run workflow** (`workflow_dispatch`): both steps skip what
already exists.

The release PR is opened with the workflow's `GITHUB_TOKEN`, so GitHub does not
run CI on it; CI runs on the merge to `main` instead, and the publish waits for
it.

## Authentication

The publish job runs in the `npm` environment and authenticates with npm
trusted publishing (OIDC): no token is stored. On npmjs.com, the `mockpit`
package's **Settings → Trusted publishing** names the GitHub repository
`fabiogaliano/mockpit`, the workflow `release.yml`, and the environment `npm`.

npm can only attach a trusted publisher to a package that exists, so the very
first publish needs a token: add a granular npm access token with publish rights
as the `NPM_TOKEN` secret (on the `npm` environment), let one release publish,
configure trusted publishing, then delete the secret.

The repository must allow GitHub Actions to create pull requests (**Settings →
Actions → General → Workflow permissions**) for the release PR to open.

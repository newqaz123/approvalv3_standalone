# Unified Safe Deployment Design

**Date:** 2026-08-10
**Status:** Approved
**Scope:** Online Ubuntu VPS updates and future offline intranet deployments

## Goal

Provide one beginner-safe, interactive deployment entry point that preserves the existing PostgreSQL database and uploaded files while supporting two release sources:

1. an internet-connected Ubuntu VPS that pulls from GitHub and builds locally; and
2. an offline intranet server that loads a prebuilt release package.

Both modes must use the same production runtime, backup, rollback-tagging, migration, verification, and reporting rules.

## Current Problems

The repository currently has three overlapping Compose files:

- `docker-compose.dev.yml` for local development;
- `docker-compose.yml` with both development and source-built production services; and
- `docker-compose.prod.yml` for prebuilt production images.

`scripts/deploy.sh` implicitly uses `docker-compose.yml`, while the proven VPS deployment uses `docker-compose.prod.yml`. This creates image-name drift and makes the interactive manager unsafe as the default production-update path. Environment validation, rollback-image creation, dirty-tree handling, and post-deploy integrity checks are not consistently enforced.

## Operator Experience

The operator runs:

```bash
bash scripts/deploy.sh
```

The script asks for one deployment mode:

1. **Ubuntu VPS / GitHub update**
2. **Offline intranet package**

`npm run manage` option 2 invokes the same script instead of implementing a second update workflow.

The script displays numbered stages, stops on the first failed safety gate, never prints secrets, and finishes with a deployment report containing the old and new versions, backup paths and hashes, health results, and rollback guidance.

## Compose Architecture

### Local development

`docker-compose.dev.yml` is the only local-development definition. It mounts source code, runs the development server, and uses development credentials.

### Server runtime

`docker-compose.prod.yml` is the only server runtime definition for online and offline deployments. Every production command must include:

```bash
docker compose \
  -p approval-app \
  --env-file .env.production \
  -f docker-compose.prod.yml
```

Normal updates start only:

```text
db migrate app
```

The `seed` service must use a `first-install` profile. It must not run during updates.

### Retired default file

`docker-compose.yml` is removed only after scripts, current operator documentation, package builders, and tests no longer reference it. Historical plans may retain references as historical records.

## Deployment Components

### `scripts/deploy.sh`

The single interactive operator entry point. It selects the release source and coordinates the safety pipeline. It delegates implementation details to focused shell helpers so online acquisition, offline acquisition, shared verification, and rollback handling remain independently testable.

### Online acquisition

The online path:

1. requires a Git checkout on branch `main`;
2. detects a dirty tree;
3. offers `abort` or `create a named stash and continue`, with abort as the default;
4. creates the stash only after explicit confirmation;
5. never drops or automatically reapplies the stash;
6. fetches `origin` and pulls with `--ff-only`; and
7. builds cached `runner` and `migrator` images tagged `approval-app:latest` and `approval-migrate:latest`.

Detached HEAD, non-fast-forward history, missing origin, build failure, or an unexpected branch aborts the deployment.

### Offline acquisition

The offline path accepts an extracted package directory. It validates the package version metadata, production Compose file, required scripts, image archives, and checksums before loading images. The package contains the same operator-facing deployment entry point and internal helpers so the interaction remains consistent without GitHub access.

Offline loading must not occur until rollback tags have been captured from the running containers.

### Shared environment gate

A non-interactive environment check validates `.env.production` without printing secret values. It fails when:

- a required key is missing or empty;
- `AUTH_URL`, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL` are invalid, use localhost, use non-HTTPS production origins, or do not match;
- `AUTH_TRUST_HOST` is not `true`;
- `UPLOAD_DIR` is not `/app/uploads` for the Docker production runtime;
- placeholder authentication or cron secrets remain;
- `DATABASE_URL` does not target the Compose `db` service and configured database; or
- configured PostgreSQL user/database values conflict with `DATABASE_URL`.

Password values are never logged. Password-strength warnings are actionable but must not silently rotate credentials.

### Backup

Before replacing an image or container, deployment calls the existing backup workflow and verifies that both database and uploads artifacts are non-empty. It prints each artifact path and SHA-256 hash.

The backup implementation must resolve the actual running container volumes rather than guessing by an unqualified volume name. A backup failure aborts deployment while the old application remains available.

### Rollback tagging

Rollback tags are created from the image IDs used by the running containers, not from mutable `latest` tags:

```text
approval-app:rollback
approval-migrate:rollback
```

Tagging occurs before online builds or offline image loading. Before replacement, the existing rollback tags are retained as `rollback-prev` when they exist.

### Production deployment

After acquisition succeeds, the shared runtime command starts `db`, runs forward-only `prisma migrate deploy`, and starts `app`. It never invokes:

- the seed service;
- `docker compose down -v`;
- `docker volume prune`;
- `prisma migrate reset`;
- `prisma db push`; or
- destructive database restoration.

`.env.production` and existing Docker volumes are preserved.

## Verification

Deployment records the pre-deploy commit/version, container image IDs, Compose project, database volume, uploads volume, user count, attachment-record count, and upload-file count.

After deployment it verifies:

- the migration container exited successfully;
- the database and application are healthy;
- `/api/health` returns HTTP 200;
- the Compose project remains `approval-app`;
- database and uploads volume identities are unchanged;
- the uploads volume is mounted at `/app/uploads`;
- user, attachment, and upload-file counts did not unexpectedly decrease; and
- the public origin configuration remains valid.

Exact count equality is not required while the application accepts live traffic. If a future maintenance mode blocks writes, the verifier may require equality for that deployment window.

The verifier runs a read-only attachment-integrity audit that compares every database `filePath` with physical storage. It reports pre-existing metadata/file mismatches without deleting or repairing records, and fails when the deployment introduces a newly missing file.

## Failure and Rollback Policy

A failure before container replacement leaves the old application running and exits non-zero with a specific remediation message.

A failure after deployment begins does not automatically reverse database state. The script determines whether migrations were applied:

- If no migration was applied, it offers an application-image rollback.
- If migrations were applied, it warns that the previous application may be schema-incompatible and requires operator review.

Rollback restores image tags and recreates the application through the repository-root `docker-compose.prod.yml`, explicit project name, and production environment file. Rolling back the migrator image does not reverse an applied migration.

The rollback script supports the source-checkout location `scripts/rollback.sh` and the package-root location used by offline releases.

## Manager Integration

`tools/manage.mjs` option 2 delegates directly to the unified interactive deployment script. It does not separately ask for an update source, create a divergent backup sequence, or invoke the retired deployment path.

Environment editing remains available as a separate manager option, but deployment always runs the non-interactive gate regardless of whether the operator previously opened the editor.

Backup, restore, health-check, and rollback manager options continue to call their dedicated scripts.

## Security Boundaries

This change does not silently rotate production credentials. PostgreSQL password rotation requires a separate coordinated procedure that changes the database role and environment configuration together.

Production port exposure is reviewed explicitly. The intended Nginx deployment binds the application to localhost, avoids publishing PostgreSQL unless operationally required, and keeps Prisma Studio behind a localhost binding or SSH tunnel. Any port change must be documented and validated against the current VPS firewall/proxy setup before rollout.

## Testing Strategy

### Automated tests

Tests use temporary directories and fake `git`, `docker`, and Compose executables to verify:

- interactive online/offline mode selection;
- environment-gate success and each failure category;
- dirty-tree abort and named-stash behavior;
- rollback tags use running container image IDs;
- online fast-forward-only pull behavior;
- offline package/checksum validation and image-loading order;
- backup artifact validation and hashing;
- production commands include the project, environment file, production Compose file, and explicit services;
- prohibited destructive commands and seed execution are absent;
- migration and health failures exit non-zero; and
- rollback uses the repository-root Compose file from both supported script locations.

Compose tests run `docker compose config --quiet` for development and production definitions. Package tests confirm the offline artifact contains the unified deployment entry point, internal helpers, production Compose file, version metadata, checksums, and required images.

### Repository verification

Before completion:

```bash
bash -n scripts/*.sh
npm run check
npm run build
docker compose -f docker-compose.dev.yml config --quiet
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
```

A disposable Docker smoke test proves that a recreated application reads the same database and uploads volumes. It must not target production data.

## Documentation

Current operator documentation becomes authoritative and distinguishes:

- local development;
- first-time online installation;
- routine online VPS update;
- first-time offline installation;
- routine offline package update;
- environment remediation;
- rollback limitations; and
- named-stash recovery.

The README manager section must accurately state that option 2 invokes the unified deployment flow. Commands must use the explicit production project, environment file, and Compose file. Historical planning documents remain unchanged unless they incorrectly present themselves as current operator instructions.

## Acceptance Criteria

- One interactive `deploy.sh` supports online VPS and offline package deployment.
- Both modes share environment, backup, rollback-tagging, runtime, verification, and reporting behavior.
- Production updates use only `docker-compose.prod.yml` and services `db migrate app`.
- Local development uses only `docker-compose.dev.yml`.
- `docker-compose.yml` has no live consumer and is removed.
- Manager option 2 calls the unified deployment flow.
- Seed cannot run during an ordinary update.
- Existing database and uploads volumes retain their identities across a disposable deployment test.
- Rollback tags reference the previously running images.
- No automatic rollback occurs after an applied migration.
- README and deployment documentation match tested behavior.

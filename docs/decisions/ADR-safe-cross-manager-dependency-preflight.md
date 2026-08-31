# ADR: Safe cross-manager dependency preflight

## Status

Accepted for BUI-813. Critical exact-diff review on 2026-08-30 found and closed
additional version, PnP, archive, parser, and telemetry trust boundaries.

## Context

The quality runner checks that package manifests, lockfiles, installed package
identities, and package-local commands agree before it creates an immutable
campaign. The current source-owned check supports npm only. It stops pnpm,
Yarn, and Bun projects even when their dependency state is exact.

The missing support is a trust-boundary defect, not only a format gap. Package
manager state is repository-controlled input. In particular, modern Yarn PnP
normally stores its dependency map in executable `.pnp.cjs`. Loading that file
during preflight would run repository code before the quality sandbox exists.
The same boundary excludes package-manager commands and binary lockfile
decoders from the verifier.

The supported formats also have material differences. Current pnpm lockfiles
can contain two YAML documents; the project graph is the last document. Modern
Yarn can use `node_modules` or PnP. Bun uses a JSONC text lockfile and retains a
legacy binary format. Workspaces can replace a registry package with a local
path in every manager.

The threat model treats repository-controlled files as hostile. The host,
runner installation, and other processes under the runner's operating-system
principal are trusted. A same-user process can replace the verifier itself, so
defending against that principal is outside this preflight boundary.

## Decision

Keep one source-owned verifier and add format adapters behind a common result:
the root manifest spec, exact locked identity, installed identity, and required
command artifact for every direct production and development dependency.

All adapters parse data only. They do not import repository files, execute
lockfiles, invoke package managers, or resolve through Node loaders. Every
workspace, `file:`, `link:`, `portal:`, and other local or soft-link locator is
resolved canonically and must remain inside the repository root. Every installed
package root and command target is also resolved canonically and must remain
inside the repository root. The only exception is a Yarn hard-cache archive
whose bytes match the lockfile checksum and whose contents are inspected without
execution.

Manager selection is deterministic. A root `packageManager` declaration names
the authoritative adapter and must have the form `<manager>@<exact-version>`.
Its required lockfile must exist. Other retained lockfiles are inactive and are
not fallback inputs. Without the declaration, exactly one supported manager
lockfile must exist; zero or multiple candidates fail with an instruction to
add `packageManager`. A declaration, lockfile, or installed-state linker
conflict always fails.

When `packageManager` is declared, its exact version must be able to consume
the selected lock schema. The supported minimums are npm 7 for package-lock v2
and npm 9 for v3/v4; pnpm 9 for lock schema 9; Yarn 4 for schemas 8 through 10;
and Bun 1.2 for text schema 1 or Bun 1.4 for schemas 2 and 3. An inferred
manager has no version assertion, so its other schema and state checks remain
authoritative.

All filesystem objects are opened without following their final path component,
then checked with `fstat` before and after reading. Symlink targets are resolved
canonically first and their resolved objects receive the same open and identity
checks. External Yarn archives are read and inspected from the same open file
descriptor whose bytes are checksummed. A replacement or mutation during a read
fails.

Repository-controlled inputs have fixed limits before parsing: 256 MiB per
manifest, lock, or linker-state file; 128 levels, 100 aliases, and 1,000,000
nodes per YAML or JSONC document; and 50,000 entries, 2 GiB total expanded data,
512 MiB per entry, and a 100:1 expansion ratio per ZIP archive. Duplicate,
absolute, parent-traversal, device, and non-file ZIP entries fail. Limit breaches
fail as malformed manager state before campaign creation.

The initial support boundary is explicit:

- npm package-lock v2 through v4 retain the existing behavior, including v4
  patched-package and package-extension graph metadata.
- pnpm lockfile schema 9 is read with a maintained YAML multi-document parser.
  It accepts exactly one project document or exactly two documents in pnpm's
  documented environment-plus-project order. The project document supplies the
  root importer. Both its specifier and selected version or contained local link
  must match the manifest.
- modern Yarn lock schemas 8 through 10 are read with Yarn's maintained data
  parser. The `node-modules` linker binds the selected lock locator to
  `node_modules/.yarn-state.yml`; the `pnpm` linker binds it to
  `node_modules/.package-map.json` and its configured contained store. In both
  cases, the installed package manifest and local command links must match that
  locator. For PnP, only Yarn's documented `.pnp.data.json` form is accepted.
  The verifier binds root dependency references to `yarn.lock` and never reads
  or executes `.pnp.cjs`. Local and soft package locations must be contained.
  An external hard-cache archive is accepted only when its bytes match the Yarn
  lock checksum. A maintained ZIP-aware reader verifies package identity and
  every declared bin target inside cached archives; archive package manifests
  receive the same JSON resource and forbidden-property checks as filesystem
  manifests, and bin targets must remain under the archive package root.
  Directory artifacts receive the same checks. PnP requires
  `pnpEnableInlining: false` even when a stale `.pnp.data.json` exists.
  Inline-only PnP stops with an instruction to set
  `pnpEnableInlining: false` and reinstall immutably.
- Bun text lock schemas 1 through 3 are read as JSONC. The root workspace spec,
  effective override, and package resolution must match the manifest, then the
  installed package identity and local command artifacts must match. Schema 2
  security metadata and schema 3 override records are validated with the
  selected package record. Bun's external global-store mode is rejected with an
  instruction to disable `install.globalStore` and reinstall frozen. `bun.lockb`
  stops with Bun's documented text migration command.

On POSIX systems, command symlinks must resolve to the declared contained bin
target. Regular POSIX shell shims, including pnpm's normal form, must byte-match
the supported manager's complete template after target and `NODE_PATH` fields
are normalized; every normalized path must be contained and the target must be
the declared bin file. Every `NODE_PATH` entry must already exist; an unresolved
leaf cannot inherit trust from a lexical path beneath a symlink. The owning
package root for every command must be present at the exact install location
recorded by the active lock graph, including transitive command owners. On
Windows, every generated command wrapper (`.cmd`, `.ps1`, and the extensionless
shim) receives the same complete-template check. Unknown wrapper forms or
platforms fail closed.

Registry selections must satisfy the root manifest's SemVer range after npm
alias resolution. Repeating the manifest specifier in a lockfile is not enough:
the selected npm, pnpm, Yarn, or Bun version is checked independently. Local
selections must use a permitted local protocol and bind its exact contained path
or workspace range.

An unknown lock schema, an unsupported Yarn linker, a missing data artifact,
an ambiguous selector, a stale manifest spec, a missing package, an identity
mismatch, a missing command, a path escape, or malformed data is a preflight
failure. No adapter falls back to another lockfile or to installed state alone.
The failure names the exact manager and repair action. Existing failure
telemetry remains authoritative.

## Alternatives considered

1. Run each package manager with its frozen or immutable flag. Rejected: this
   executes repository-controlled package-manager configuration and lifecycle
   surfaces before campaign isolation, and it can use network or mutate caches.
2. Load `.pnp.cjs` or `pnpapi`. Rejected: both execute the repository-generated
   loader. A malicious fixture would gain pre-campaign code execution.
3. Implement YAML, JSONC, and Yarn parsing with regular expressions. Rejected:
   these formats contain quoting, aliases, comments, and multiple documents.
   Partial parsers can accept the wrong dependency graph.
4. Accept every historical lockfile schema. Rejected: unverifiable versions
   must stop. Support can expand with fixtures and an explicit schema decision.
5. Check only `node_modules`. Rejected: installed state does not prove that the
   committed manifest and lockfile select the same dependency.

## Invariants

The source-owned preflight runs on Linux and macOS hosts, where Node exposes
`O_NOFOLLOW` for stable non-symlink reads. Unsupported hosts fail at an explicit
platform gate. Supported hosts still validate committed Windows command
wrappers as dependency artifacts; that does not claim Windows host execution.

1. Preflight never executes repository-controlled JavaScript or a package
   manager.
2. Every accepted dependency binds manifest spec, lock selection, installed or
   PnP artifact identity, and every declared command target. A linker that uses
   `.bin` must also expose the matching command link.
3. Every local or soft-link target, installed package root, and command target
   resolves canonically inside the repository root and has the expected package
   name and version. Only a checksum-verified Yarn hard-cache archive can remain
   outside it.
4. A parser reads the complete authoritative document. pnpm accepts only its
   one-document or ordered two-document layout; extra documents fail.
5. Unsupported or malformed state fails before immutable campaign creation and
   records the existing structured telemetry.
6. npm acceptance and failure behavior does not weaken.
7. The manager is authoritative by exact root declaration or, only when absent,
   by one unambiguous supported lockfile.
8. Reads bind checks to open object identities and enforce deterministic parser
   and archive resource limits.
9. Thrown inspection errors become structured failures and use the same
   telemetry and remediation path as adapter-returned failures.

## Rollback

The adapters are additive. Revert one adapter and its dependency and fixtures
together. The manager returns to the existing fail-closed result; npm remains
available. Never replace a removed adapter with package-manager execution.

## Verification

- Exact npm, pnpm, Yarn node-modules, Yarn JSON PnP, Bun, and workspace fixtures
  pass.
- Manifest/lock mismatch, stale lock selection, wrong installed identity,
  missing dependency, missing command, unknown schema, unsupported linker,
  path escape, and malformed parser input fail with the manager repair command.
- Registry selections outside the manifest constraint, local locator/spec
  mismatches, unlocked command owners, and unresolved `NODE_PATH` entries fail.
- One- and two-document pnpm fixtures pass; reversed, incomplete, and extra
  document layouts fail.
- A malicious `.pnp.cjs` fixture cannot create a marker file and inline-only
  PnP fails closed.
- Yarn node-modules fixtures reject a stale locator with the same name/version;
  PnP directory and ZIP fixtures reject missing declared bin targets.
- External `file:`, `link:`, and `portal:` fixtures fail for every manager that
  supports the protocol; contained local dependencies pass.
- External installed-package and command symlinks fail for every linker; a
  checksum-verified Yarn hard-cache archive remains the only path exception.
- npm v2 and v3 and Bun v2 fixtures pass; unsupported newer schemas fail
  closed. npm v4 remains unsupported until its graph metadata is verified.
- Bun v3 override fixtures pass, and global-store installations fail with the
  contained-install repair action.
- Exact manager declarations select their matching retained lockfile; missing,
  malformed, schema-incompatible, mismatched, and undeclared ambiguous manager
  states fail.
- Stale PnP JSON with an inline loader, archive bin traversal, hostile archive
  manifests, and thrown inspection failures all fail with structured evidence.
- PnP selects the unique repository root instead of trusting workspace order;
  executable symlinks still require exact Windows sibling wrappers.
- pnpm reads its invariant modules state once, YAML depth fails before document
  composition, and scoped Bun local locators bind the declared package name.
- ZIP expansion is checked against bounded actual output, malformed flow depth
  fails before YAML composition, dependency-free `.bin` state fails closed,
  and package-manager declarations require complete valid SemVer.
- Aggregate ZIP expansion fails before decompression exceeds its remaining
  budget, and installed manifest reads bind the opened object to the contained
  path identity after opening.
- Mutation-during-read fixtures, parser limit fixtures, ZIP bombs, duplicate or
  unsafe ZIP entries, and POSIX symlink, POSIX shell-shim, and Windows command
  escapes fail closed.
- Legacy `bun.lockb` reports Bun's exact text migration command.
- The existing npm fixtures and the complete repository audit remain green.

## Delivery tasks

- [x] 1.0 Define the safe cross-manager verification contract
  - Phase: contract
  - Delivers: Accepted manager, lockfile, installed-state, path, parser, and archive invariants.
  - Evidence: This ADR and its malicious-fixture verification matrix.
- [x] 2.0 Implement the source-owned dependency preflight
  - Phase: implementation
  - Delivers: Exact npm, pnpm, Yarn, and Bun verification before quality campaign creation.
  - Evidence: Focused manager fixtures, live local manager proofs, and the complete repository audit.

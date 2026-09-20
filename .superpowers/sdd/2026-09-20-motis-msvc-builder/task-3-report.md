# Task 3 report

## Status

Checkpoint committed as Task 3 implementation. The requested verifier was not restored from deletion because the task brief explicitly requires modifying `scripts/motis/verify-patched-build.mjs`; the file is present in the final commit.

## Included

- Added `scripts/motis/create-release-candidate.mjs` to emit manifest schema v2 with locked source/patch metadata, MSVC/Ninja builder observation, source diff, binary metadata, runtime DLLs, licenses, validation state, and a complete sorted file inventory.
- Updated `scripts/motis/verify-patched-build.mjs` to fail closed on schema/metadata/toolchain mismatches, traversal and duplicate inventory paths, missing licenses or CRT, missing UI/profile payloads, unlisted executable/DLL payloads, and file size/hash mismatches.
- Updated the MSVC staging script to require Node, create the v2 manifest, verify it before publication, and retain the staged build only after verification succeeds.
- Updated release bootstrap and packaging tests for v2 distributions, locked candidate binary hashes, and rejection of the official 16-way fallback.
- Updated `scripts/package-win.mjs` so packaging always requires the verified custom distribution and cannot fall back to the official MOTIS distribution.

## Verification

- Ran the requested focused command once before the checkpoint: 21/22 tests passed; the single failure was the non-binary tamper assertion because the fixture changed file size and the verifier correctly reported the size mismatch before hashing.
- Corrected the fixture to preserve its original 25-byte size and confirmed the two fixture strings are both length 25 with a static command.
- Ran `git diff --check` successfully.
- Per the user’s stop instruction, no further tests, builds, full suite, network access, external workflows, or agents were run.

## Commit

The coherent Task 3 changes are committed in the current worktree.

## Finalization status

Reviewed against the Task 3 brief and current diff: the implementation is coherent for manifest v2 creation, strict inventory/hash verification, and fail-closed bootstrap. Restored unrelated `scripts/package-win.mjs` drift. No tests or long-running commands were run during finalization, per instruction; only repository inspection and diff checks were performed.

## Review-finding fix checkpoint

- Removed the `TRANSIT_ALLOW_OFFICIAL_MOTIS` and `vendor/motis/windows` package fallback. Every selected package distribution now runs the Custom MOTIS manifest verifier, and missing or invalid Custom MOTIS fails packaging.
- Changed manifest and `builder-observation.json` verification to require a locked builder lock and exact compiler, Windows SDK, CMake, Ninja, generator, and runner metadata. Test-only bootstrap fixtures can supply an explicit locked lock path.
- Defined the complete VC143 app-local CRT inventory (`concrt140.dll`, all required `msvcp140*` DLLs, `vccorlib140.dll`, and both `vcruntime140*` DLLs), made the builder require and copy each file explicitly, and made candidate creation and verification reject any missing member.
- Expanded focused fixtures and regressions for locked metadata drift, probe-lock rejection, and a self-consistent manifest missing one CRT DLL.

### Checkpoint verification

- Before the production fixes, the bounded focused run reported 5 failures and 29 passes. The failures reproduced the official fallback, unlocked metadata acceptance, incomplete CRT acceptance, and wildcard CRT staging; one inventory-order expectation was then corrected.
- Per the checkpoint instruction, no tests or other verification commands were run after applying the production fixes.

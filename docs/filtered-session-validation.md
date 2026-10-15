# Filtered session boundary regression

R1 is a loss-of-identity defect in the filtered menubar path: daily aggregation
assigns each session to its first day, so slicing those days cannot count sessions
active later. The fix counts active sessions from the shared filtered dataset
before aggregation, preserving the existing current cost, provider, and history paths.

The regression was committed before implementation at clean commit
`b1f2b46db115deed435902ec5979f40d729b4712`.
`git status --porcelain` produced no output before the red run.

Red command: `npm test -- --run tests/cli-menubar.test.ts -t 'counts sessions active across'`.
Result: 3 failed, 15 skipped. Exact failure:
`AssertionError: expected +0 to be 1 // Object.is equality`,
at `tests/cli-menubar.test.ts:108:36` on the current-session assertion.
The cases cover project inclusion, exclusion, and project plus provider.

After implementation, the single focused verification command
`npm test -- --run tests/cli-menubar.test.ts` passed all 18 tests.
The regression also checks that a session spanning two days counts once for the week.
No full suite, lint, build, push, PR, or CI phase was run.

Both executions used the offline-home preload, an empty synthetic home, all
provider-path overrides, isolated cache, and TMPDIR beneath `.cache/review-r1/`.
The initial attempt could not launch Vitest because dependencies were absent.
Local `npm ci --ignore-scripts --cache .cache/npm` installed the locked dependencies;
the actual test runner reported Vitest 3.2.4.

Local proof files (relative to the worktree; ignored scratch artifacts):

- `.cache/review-r1/red-head.txt`: full regression commit SHA.
- `.cache/review-r1/red-status.txt`: empty clean-status output.
- `.cache/review-r1/red.log`: complete failing regression output.
- `.cache/review-r1/green.log`: complete passing focused verification output.
- `.cache/review-r1/run.sh`: exact isolation environment and test invocation.
- `.cache/review-r1/install.log`: local dependency installation output.

# ADR: Quality merge-train coordinator

## Status

Proposed. Two independent high-reasoning architecture reviews found that one
linear pull-request record cannot model pre-manifest admission and cumulative
GitHub candidate generations. This revision separates those aggregates. No
implementation may start until a clean architecture review accepts this
revision and the GitHub evidence spike in the rollout proves its server-binding
assumptions. A later cross-provider Claude review found five state and interface
contract defects; this head addresses them but has not received a clean
post-fix review.

## Context

The quality runtime can review and test a pull request against an exact base. It
also has a repository merge lease that prevents two local merge campaigns from
racing. However, the runtime does not own an ordered integration candidate from
enqueue through authoritative merge read-back.

The root cause is that merge authority is split between local leases,
exact-head evidence, and GitHub protection, with no common coordinator for the
candidate that contains the current base and the earlier train members.

This creates three different problems that must not share one name:

1. A **repository train** orders integration candidates for one protected base.
2. A **dependency coordinator** orders repositories, such as merging a runtime
   change before advancing a consumer's submodule.
3. **Fleet admission** limits concurrent provider and CI cost. It does not
   decide merge order.

`quality-ci-evidence.js` already recognizes a `merge-group` candidate and
requires a GitHub Actions `merge_group` event. The current quality workflow does
not trigger on that event, and the merge authorization path does not enqueue or
monitor a merge group. The existing repository lease remains necessary for
repositories that cannot use a server merge queue.

GitHub merge-queue availability and enforceability can depend on repository
capability and configuration. Eligibility for each repository in this fleet is
`[unverified]` and must come from the live capability check in this decision. It
must not be inferred from repository visibility or a local profile. GitHub does
require each required Actions workflow to listen for the `merge_group` event.

Primary references:

- [Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [Merging a pull request with a merge queue](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue)
- [Repository-scoped quality merge lease](ADR-repository-merge-lease.md)

## Decision

Add one repository-scoped `MergeCoordinator` to the shared quality runtime. The
coordinator selects one of two adapters from verified repository capability and
policy. Callers state merge intent. They do not call GitHub merge APIs or
implement candidate construction.

The first interface is small:

```text
inspect(repository, base) -> capability
submit(intent) -> trainId
admit(trainId) -> waiting | reservation
bind(reservation, manifest) -> receipt
enqueue(trainId) -> receipt
reconcile(trainId) -> state
cancel(trainId, reason) -> state
```

`submit` writes a durable intent before a quality manifest exists. The intent
contains the repository, protected base, pull request, expected head, adapter
policy, unresolved upstream train IDs, budget identity, and submitter identity.
It grants no review, lease, or merge authority.

`inspect` reads live repository and protected-branch capability. Its result
binds the observed protection and queue policy, required workflows, observation
time, and expiry. It writes no intent and grants no authority. An expired,
partial, or failed observation is not reusable by `submit` or `admit`.

`admit` resolves dependencies and orders repository work. Its reservation is a
short-lived, fenced scheduling credential. For the lease adapter, only the
repository queue head may create and bind a merge manifest. `bind` then proves
that the manifest acquired the existing repository lease. The reservation does
not replace that lease and cannot authorize a remote operation.

`reconcile` starts from the latest valid receipt and performs the adapter's live
authoritative read. It appends a transition only when the remote repository,
pull request, head, candidate generation, queue or operation identity, and
outcome all match. It never derives a remote outcome by replaying local
receipts. An unavailable or inconsistent read after a remote operation enters
`quarantined`.

`cancel` records intent before any remote operation. Before enqueue, it may
cancel an exact waiting or admitted intent after releasing only its scheduling
reservation. After enqueue, it requests adapter cancellation and then calls
`reconcile`; only authoritative proof that the exact queue entry cannot merge
permits `cancelled`. Otherwise the train enters `quarantined`.

Every transition writes an append-only receipt. A train receipt contains the
adapter kind, repository, pull request, reviewed head and base, patch identity,
resolved dependency commits, manifest and lease identity, and timestamps. A
candidate-generation receipt separately contains the candidate SHA and tree,
effective base SHA, merge method, complete ordered membership, member evidence,
stable remote queue and operation identities when GitHub exposes them, and
timestamps. A mutable status view may point at the latest receipts, but it is
not evidence by itself.

### Adapter 1: GitHub native queue

Use this adapter only when a live capability check proves that the repository
and protected branch have an effective merge queue and the required workflows
support `merge_group`.

GitHub can build a later queue candidate from the protected base plus pull
requests ahead of it. The candidate generation is therefore an aggregate. It
must bind the complete ordered membership as exact pull request and head pairs.
For every member, the coordinator verifies signed review evidence for that
member's exact patch and head. Required deterministic checks then run on the
shared candidate SHA and cover the interaction between members. If the API or
event evidence cannot enumerate and bind complete membership, the native
adapter is unavailable.

The effective protected-branch policy must require the signed review-evidence
context before a pull request can enter the queue. This includes queue members
that another user or host submitted. A locally known manifest is not required
for a foreign member, but its exact signed review evidence is required and must
verify under the same policy.

The adapter:

1. validates the immutable quality manifest and exact reviewed pull-request
   head for the train being enqueued;
2. enqueues the pull request through GitHub instead of merging it directly and
   records the returned queue-entry identity before monitoring;
3. discovers the exact merge-group identity, complete ordered membership,
   candidate SHA and tree, and effective base from GitHub;
4. verifies every member's exact signed review evidence, then binds required
   check evidence to that merge-group SHA and a
   `merge_group` Actions run;
5. monitors replacement merge-group generations when an earlier queue member
   changes the candidate;
6. enters `merge-pending` only for the latest successful candidate generation;
7. accepts success only when durable GitHub evidence binds the recorded queue
   entry and merge group to the protected-branch result, and that result has the
   tested candidate tree, expected prior base, merge method, and reviewed pull
   request head; and
8. quarantines an unavailable, out-of-band, or ambiguous remote result.

The implementation must first prove that GitHub exposes enough durable API,
event, or webhook identity to bind a completed queue entry to the protected
branch result. Exact tree and parent checks are required but do not by
themselves prove that the coordinator-authorized queue operation performed the
merge. If this durable server binding is not available, the native adapter is
unsupported and rollout stops. It must not reduce the predicate to “the same PR
head is now merged.”

GitHub is the cross-host merge arbiter for this adapter. The local repository
lease prevents duplicate local campaign actions, but it does not claim to fence
GitHub or another host. A queue receipt and GitHub read-back are the authority.

Required Actions workflows must add `merge_group` triggers. Their affected-test
selection must compare the merge-group candidate with its effective protected
base. A pull-request run, a branch-head run, or a PR rollup cannot satisfy this
candidate.

Provider review remains bound to the pull-request patch, not to each generated
merge-group commit. A base movement can carry review only when the existing
binary replay proof produces the exact expected tree for the same patch. A
conflict, missing object, changed dependency, or tree mismatch requires fresh
review. Deterministic checks always run on the current merge-group SHA.

### Adapter 2: repository lease

Use this adapter when native queue capability is absent. It keeps the accepted
repository merge lease and strict required-status-check path.

The intent queue orders contenders before manifest creation. It is a scheduler,
not another merge lease. When one intent reaches the queue head, `admit` returns
the only active reservation for that repository. The caller creates its merge
manifest, existing bootstrap acquires the accepted repository lease, and
`bind` verifies both credentials. A direct legacy campaign that already owns
the lease remains authoritative and makes the admitted intent wait.

After binding, the first version preserves the accepted lease scope for the
full merge campaign. It does not run a review-only invocation and then copy its
evidence into a merge manifest. The current review authorization and coverage
contracts do not permit that promotion.

The adapter:

1. acquire the repository lease with its existing fencing token;
2. fetch and bind the current protected base;
3. rebase the pull-request patch onto that base;
4. carry review only after the existing exact binary replay and tree-equality
   proof succeeds;
5. push the new pull-request head and run required checks on that exact head;
6. revalidate the live base, required checks, signed review evidence, lease,
   and head immediately before merge; and
7. use the existing guarded merge and authoritative remote reconciliation.

This adapter does not create a hidden local merge commit as its release
candidate. A local `git merge-tree` result can detect a conflict and can help
test candidate construction, but it is not a server-visible SHA with protected
checks and it grants no merge authority.

The lease adapter processes one merge campaign at a time. Independent
review-only work may run concurrently, but it cannot become merge authorization
evidence. Later merge intents wait before manifest creation, base binding,
gates, and provider review, so they do not consume repeated full review and CI
runs against a base that the active member will replace. An expired admission
reservation returns the intent to waiting without releasing, rotating, or
changing the repository lease.

A later optimization may shorten the lease scope only after another accepted
design adds a signed evidence-promotion boundary. That boundary must validate
the source invocation, exact patch, provider authorization, risk policy,
artifacts, budget accounting, destination lease token, and one-time promotion
under the destination manifest lock.

### Repository train state

A train intent and a candidate generation have separate append-only transition
logs.

The train intent follows the main path:

```text
submitted -> dependency-wait -> admitted -> manifest-bound -> reviewing
          -> ready -> enqueued -> merged
```

Valid exits are explicit:

| Active train state             | Valid non-success exits                       |
| ------------------------------ | --------------------------------------------- |
| `submitted`, `dependency-wait` | `blocked`, `stale`, `deferred`, `cancelled`   |
| `admitted`                     | `stale`, `deferred`, `cancelled`              |
| `manifest-bound`, `reviewing`  | `failed`, `stale`, `cancelled`                |
| `ready`                        | `failed`, `stale`, `deferred`, `cancelled`    |
| `enqueued`                     | `failed`, `stale`, `quarantined`, `cancelled` |

An enqueued train has one current candidate generation:

```text
created -> checking -> green -> merge-pending -> merged
        \-> superseded
        \-> failed
        \-> quarantined
        \-> cancelled
```

`created` means the adapter persisted the complete ordered membership,
effective base, candidate SHA and tree, and remote generation identity.
`checking` begins only when the required `merge_group` workflow run for that
exact candidate SHA is observed. `green` requires every effective required
context to succeed from its required app on that exact SHA, plus verified signed
review evidence for every member. `merge-pending` begins only when GitHub starts
the remote integration of that latest green generation.

GitHub replacement moves the prior generation to `superseded` and creates the
next generation; it does not move the train back through provider review when
exact replay proof remains valid. A cancellation reaches `cancelled` only after
the adapter proves that no remote merge can still complete. A failed upstream
dependency produces `blocked` only while the dependent intent is `submitted` or
`dependency-wait`, before admission, manifest creation, or provider use.

`deferred` is a reversible admission result used when policy or bounded
provider/CI capacity cannot start the intent before any remote operation. The
same exact intent may return to waiting when capacity changes. `stale` means an
identity or evidence anchor changed, such as the PR head, protected base,
resolved dependency commit, or capability snapshot; it requires a newly bound
intent or the existing authorized manifest-advance path and cannot resume only
because capacity became available.

Only the coordinator changes integration state. Gate and review workers return
evidence; they do not merge, enqueue, reorder, or release a lease.

### Cross-repository dependencies

Repository trains remain independent. A small dependency graph controls when a
candidate may enter `ready`.

An edge records an immutable upstream commit requirement, not only a repository
name. For example:

```text
claude-kit pull request -> merged claude-kit commit
                        -> claude-setup core gitlink update
                        -> claude-setup pull request
```

A submitted intent may name an unresolved upstream train ID. Admission waits for
that train's verified merged receipt, resolves it to the immutable upstream
commit, and writes that commit into the dependent reservation. Only then may
the consumer create its manifest, update and pin the gitlink, or start gates and
provider review. A failed upstream candidate moves the dependent intent to
`blocked` while it is still `submitted` or `dependency-wait`, without consuming
its review or CI budget. The first implementation supports explicit edges only.
It does not infer dependencies from repository names or branch text.

### Fleet admission

Fleet admission may reserve provider starts, provider time, and CI capacity for
several repository trains. It is an advisory scheduler above the coordinators.
It cannot mark a candidate reviewed, authorize a merge, carry evidence, or
replace repository and GitHub arbitration.

Any prior batch planner named `merge-train` must be renamed to describe fleet
admission before reuse. Combining these concerns would make a budget decision
look like merge authority.

## Invariants

1. No candidate merges without complete review coverage for its exact patch or
   an existing authorized exception with the same exact scope.
2. No candidate merges without required deterministic checks on the exact
   integration candidate SHA.
3. The integration candidate contains the current protected base and every
   earlier train member that GitHub or the lease adapter has already merged.
4. Review carries across base movement only after exact binary replay produces
   the expected tree. Patch-ID equality alone is not sufficient.
5. Workers never merge directly. Only the selected adapter may enqueue or
   enter the guarded merge section.
6. One train has at most one active candidate generation. A cumulative GitHub
   candidate may contain several ordered train members.
7. Every native candidate receipt binds its complete ordered membership. Every
   member has verified signed review evidence for its exact patch and head.
8. Native merge success is bound to the latest green queue generation and its
   protected-branch result. A merged PR head alone is not proof.
9. A remote timeout or inconsistent result enters `quarantined`; elapsed time
   and a negative observation never prove that a merge did not occur.
10. A dependent repository cannot enqueue until its exact upstream commit has
    merged and is pinned in the dependent candidate.
11. Waiting, replacement candidates, and resume do not create a new quality
    invocation or replenish an operator budget.
12. Capability is read live and fails closed. Repository visibility, plan, or
    configuration is never inferred from a stale local profile.

## Failure handling

- A queue candidate replaced by GitHub creates a new candidate generation. It
  reuses review only under invariant 4 and must collect new exact-candidate CI.
- A queue candidate whose complete ordered membership or any member review
  cannot be proved is unsupported and fails closed.
- A queue workflow without `merge_group`, an unknown required context, or a
  wrong-app check fails before enqueue is called ready.
- A lease owner that stops follows the accepted fenced recovery contract. The
  coordinator does not add a second lease implementation.
- A GitHub enqueue, dequeue, or merge result that cannot be reconciled remains
  quarantined. An operator must use an exact repository, pull request, head,
  and remote operation identity to resolve it.
- Cancellation reaches `cancelled` only after GitHub proves the exact queue
  entry is absent and the pull request did not merge. A cancellation race is
  quarantined.
- A dependency mismatch returns the candidate to `stale`. It does not silently
  update a submodule or rewrite another repository.

## Alternatives considered

### Use GitHub native queue for every repository

Rejected as a shared-runtime assumption. Native queue capability must be proved
for each protected branch. A repository without that capability, with the queue
disabled, or with evidence that the coordinator cannot bind still needs the
accepted lease path. Even if every current fleet repository proves eligible,
the public runtime cannot assume the same capability in downstream projects.

### Build one custom server-side queue

Rejected for the first version. It would duplicate GitHub's cross-host
serialization, candidate branch management, check association, and merge
reconciliation. It adds a service and credential boundary before the existing
single-operator problem requires one.

### Keep only the repository lease

Rejected as the fleet-wide design. The lease is correct for one operator host,
but it cannot serialize GitHub users, bots, or another host. Public repositories
can use a stronger server arbiter.

### Use `git merge-tree` as merge authorization

Rejected. It is useful for conflict detection and deterministic unit tests, but
its tree is not the protected server candidate. It cannot replace exact-SHA CI,
branch protection, a merge group, or authoritative read-back.

### Require one pull request per GitHub merge group

Rejected. A later queue candidate normally includes pull requests ahead of it,
and queue batch limits do not provide this build-isolation guarantee. The
coordinator must model cumulative membership.

### Run all pull requests against one frozen base, then carry green results

Rejected. Earlier train members change the effective base. Review can carry for
an exact replayed patch, but deterministic integration checks must run again on
the candidate that includes those members.

## Rollout

1. Add intent admission, the two state machines, transition validation,
   receipts, and fake adapters. Keep the current merge path active.
2. Add native-queue capability inspection and dry-run reporting. Prove
   complete ordered membership enumeration and determine whether durable GitHub
   evidence can bind a completed queue entry and group to its protected-branch
   result. Stop the native design if either proof is not available.
3. Add `merge_group` triggers and affected-test selection. Prove merge-group
   evidence and final result binding end to end in a test repository. Then
   enable the native adapter for one public repository.
4. Route the existing lease path through the coordinator without changing its
   fencing or merge operation guards. Enable it for one private repository.
5. Add explicit upstream-commit dependency edges and prove an upstream runtime
   merge followed by a consumer gitlink candidate.
6. Rename or retire any fleet batch planner that uses `merge-train` for budget
   admission. Add fleet admission only after repository trains are stable.

Each step is separately reversible. No rollout step lowers branch protection,
required review, exact-candidate CI, or remote reconciliation.

## Rollback

Disable the coordinator adapter in repository policy and return to the current
strict required-check and repository-lease path. Queue receipts and transition
logs remain read-only audit evidence. Do not delete or rewrite them.

If a native queue is disabled, remove coordinator enqueue permission only after
all active queue entries reach a verified terminal state. Restore the prior
branch protection in the same controlled change. A quarantined remote operation
must be reconciled before rollback continues.

## Verification

- State-machine tests cover every allowed main-path and exit transition for
  train intents and candidate generations and reject every other transition.
- Receipt tests bind repository, PR, reviewed head/base, patch proof,
  dependency commits, adapter, generation, and remote operation identity.
- Native-adapter contract tests prove `merge_group` workflow identity,
  exact-candidate required checks, replacement generations, dequeue, merge, and
  ambiguous-result quarantine.
- Capability tests reject a queue candidate whose complete ordered membership
  or member review evidence cannot be proved.
- Final read-back tests prove that a matching PR head with the wrong queue
  generation, candidate tree, prior base, merge method, or remote operation
  identity is quarantined.
- A test repository proves that an earlier queued merge changes the later
  cumulative candidate and forces new candidate CI without forcing fresh review
  when every member review and exact tree replay succeed.
- Lease-adapter regressions prove one full merge campaign at a time, existing
  token fencing, rebase carry, exact-head checks, guarded merge, and remote
  read-back. A review-only manifest cannot be promoted into merge evidence.
- Cross-host tests prove that GitHub, not a local lease, arbitrates native queue
  order.
- Dependency tests prove that a consumer cannot create its manifest or start
  provider work before its exact upstream commit merges and is pinned. A
  different pinned commit remains blocked.
- Admission tests prove that a lease contender creates no merge manifest and
  starts no gate or provider process before it owns the repository reservation.
- Failure injection after each remote request proves that uncertainty enters
  `quarantined` and never releases or advances another candidate.
- Focused tests, complete repository verification, prompt parity, protected CI,
  and exact-head independent review pass before release.

## Consequences

The runtime gets one merge intent and evidence model while using the strongest
arbiter each repository supports. Public repositories gain cross-host ordering.
Private repositories keep the accepted exact-head lease safety. Provider review
can carry across proved base-only rebases, but deterministic candidate CI still
runs for each integration generation.

The design adds durable coordinator state and two adapter contracts. It does
not remove GitHub branch protection, the repository lease, quality manifests,
or exact-candidate evidence. The first release will also need repository policy
that selects the adapter and migration work for required workflows.

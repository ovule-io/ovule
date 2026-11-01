# Agent execution permissions

## Ownership and defaults

Hosts owns execution policy and OS enforcement. The application loads and injects
`ExecutionPolicy` through IoC; the agent kernel depends only on the neutral provider
contract. Permissions apply to Workspace command execution, independently of Browser,
MCP and external ACP agents' own trust boundaries.

On macOS, default command execution uses Seatbelt. Reads cover the selected
Workspace, private temporary directory and existing system runtime paths, including
Rosetta's runtime. Writes cover the Workspace and private temporary directory.
Network access is disabled, and process inspection is limited to the command
itself; other processes require an explicit grant. HOME points at a private temporary directory on the same Host;
this does not create a virtual machine or switch execution to another computer.

The runtime remains fail-closed on platforms without a qualified implementation.
Remote transports retain their own policy; they reject additional permissions until
they implement the corresponding enforcement contract. There is no fallback to an
unsandboxed command.

## Trusted application configuration

The application reads `<WorkspaceDataRoot>/agent/execution-policy.json` at startup.
This file belongs to application configuration, outside the default writable
Workspace. Restart to apply changes. A missing file uses the restrictive defaults;
invalid JSON, unknown fields or invalid paths fail explicitly rather than enabling
broader access. Configuration is limited to 64 KiB.

```json
{
  "baseline": {
    "readPaths": [],
    "writePaths": [],
    "network": false,
    "processInfo": false
  },
  "allowRequests": true
}
```

Baseline permissions are trusted host configuration and apply without per-command
approval. `allowRequests: false` rejects requests beyond that baseline. The four
permission dimensions are independent: a read grant does not grant writes, and a
write grant does not grant reads. `network` permits network operations for the
command, without a hostname allowlist. It also enables reads of exact public resolver/TLS
configuration files needed by system network clients. `processInfo` permits additional process
inspection; it does not grant control over other processes. Seatbelt can still reject
set-id executables such as macOS `/bin/ps`; the process-info permission is verified
with an unprivileged `proc_pidinfo` helper rather than bypassing this restriction.

Permission paths must exist, be absolute Unicode canonical paths below filesystem
root, and total at most 32 after combining baseline and requested paths. Symlink
aliases and paths containing unresolved components are rejected with the canonical
path to use; approval never silently changes the requested path. To create a new
file, request its existing parent directory. A path grant includes its subtree.

## Model discovery and per-call approval

Load and call `ovule_workspace_policy` with the exact binding ID. The result reports
execution location, baseline extras, default read/write boundaries, temporary HOME
behavior and whether scoped requests are supported. Remote policy fields that the
client cannot establish remain unknown rather than claiming local guarantees.

A command needing additional access can include `permissions` and a reason:

```json
{
  "bindingId": "thread-default",
  "argv": ["/usr/bin/plutil", "-p", "/Applications/Lark.app/Contents/Info.plist"],
  "reason": "Read this application's declared camera and microphone usage strings",
  "permissions": {
    "readPaths": ["/Applications/Lark.app"],
    "writePaths": [],
    "network": false,
    "processInfo": false
  }
}
```

The path above must be canonical on the target Host. The trusted provider classifies
permission-bearing invocations as `ExternalOnce`. The shared executor requires
approval for the exact command, binding and permission arguments. Task-wide automatic
grants cannot satisfy this request, and the approval UI disables task-wide grants
for it. Approval denial, unavailability, timeout and cancellation do not dispatch the
command. Grants disappear with the call; there is no automatic retry or replay.
Permission arguments alone never constitute authorization.

This initial implementation reuses the existing host approval UI. It adds neither
a new approval settings screen nor a separate automatic-review service. OS file
permissions and macOS privacy controls still apply after approval. Approving a read
path does not grant Full Disk Access or access to every system daemon.

## Results and diagnostics

The transport keeps its byte-oriented `ExecOutcome` wire contract. The provider
projects stdout and stderr to readable UTF-8 text, with lossy decoding explicitly
identified. This prevents byte-array preview limits from hiding useful errors.

- Exit code zero is `completed` unless access-denial evidence produces
  `completed_with_warnings`.
- Nonzero exits are errors. Access-denial evidence produces `permission_denied`;
  missing exit status (`-1`, as for signal termination) produces `process_terminated`;
  other nonzero exits produce `process_failed`.
- Unsupported execution or permission backends produce `execution_unavailable`.
- The shared executor projects failure classification to cards and diagnostics and
  settles the journal as failed while preserving bounded structured output.
- Tool cards show exit status and warning labels, including process failures in
  legacy cards previously marked completed.
- Diagnostic exports independently inspect exit status, so a legacy `completed`
  tool lifecycle cannot hide a failed process. Access-denial warnings are also
  classified even when the shell's final exit code is zero.

Access-denial evidence currently recognizes the standard `Operation not permitted`
and `Permission denied` text. This is a warning heuristic, not an authoritative
attribution to Seatbelt, TCC or filesystem permissions, and it does not recognize
all localized errors. Shell pipelines may mask earlier failures; separate diagnostic
commands are preferable. An inaccessible path is not evidence of absence.

## Verification

Coverage includes independent read/write grants, default network rejection and
explicit loopback access, loss of grants after a call, real Rosetta execution under
Seatbelt, exact approval arguments, rejected calls without dispatch, protection
against task-wide grant reuse and pending-request leakage, readable process errors,
warning classification and neutral kernel dependency boundaries. Native socket and
sandbox fixtures require permissions unavailable inside a restrictive test sandbox.

## Approval delivery and recovery

The host broker retains bounded metadata for live requests and exposes it through
`Agent.PendingApprovals(attemptId)`. Active conversation renderers synchronize on
mount, once per second, and when returning to visibility. Native channel events
remain the fast path. A missed event, late mount or reload can therefore recover
an existing request without issuing a new command or minting a grant. Closed or
answered request IDs cannot be replayed into live cards.

`Agent.MarkApprovalPresented(requestId)` records only that a card mounted. It does
not establish that the user read it, and never approves execution. Timeout errors
report whether this acknowledgement arrived. Explicit negative responses,
cancellation, transport/UI unavailability and the 120-second decision timeout are
separate outcomes. Diagnostics emit `timed_out` with presentation metadata instead
of misclassifying every unanswered request as `denied`.

The example report for `attempt-0069` contained two normal sandbox denials, followed
by two correctly scoped permission requests that each waited approximately 120
seconds without a decision. Those latter calls did not reach the backend; their
records cannot establish that the user clicked Deny. The historical report has no
presentation acknowledgement, so it cannot identify exactly where delivery or
interaction stopped. Replay and acknowledgement tests cover the previously missing
recovery path without claiming to reconstruct that historical event delivery.

Frontend and native ShellAPI bindings must be rebuilt together after this protocol
change. Host-side pending state remains in memory and disappears on settlement;
request arguments do not enter body-free execution diagnostics or the journal.

## Composer approval modes

The composer displays the approval mode immediately after the Agent picker. The
trusted ShellAPI owns `ask` and `review`; model-supplied arguments cannot change
them. The preference applies to the current application process, including its
other conversation windows, and resets to **Ask each time** on restart. Windows
refresh the host value rather than persisting a grant in renderer storage.

**Approve for me** invokes an injected `ApprovalReviewer` for every permission
request, including invocation-only requests. The current host policy recognizes
read-only installed-app metadata diagnostics using absolute system executable
paths: codesign display/verification, plutil print/lint, repeated PlistBuddy Print
commands, stat metadata, xattr listing, spctl assessment and ls. Canonical targets
and read grants must stay within the target bundles under `/Applications`,
`/System/Applications` or `/System/Library/CoreServices`. Nonrecursive ls of these
app directories is supported with an exact read grant. Recognized pgrep inspection
with a processInfo-only grant is also reviewable. An unnecessary read-only
processInfo grant does not force otherwise recognized metadata calls to manual
review. Shells, unknown flags, arbitrary data reads, writes and network grants
fall back to inline confirmation. The reviewer
does not create a reusable tool/task grant, disable transport enforcement or
bypass macOS privacy controls. Selecting review also evaluates already-pending
requests individually; requests outside policy remain pending.

`ovule-agent` contains only the reviewer contract and approval orchestration.
`ovule-hosts` implements command and permission classification. The application
assembly injects that policy. Additional domains can supply their own policies
through this contract without adding domain logic to the Agent kernel.

User and assistant messages may share an Attempt ID. Only the assistant message
owns its confirmation view; the user's original prompt never mounts approvals.

### Live mode changes and diagnostics

Changing mode rechecks live pending requests and new requests recheck the policy
again after registration. This closes the race where the mode-switch scan ran
between a request's initial check and its insertion into the pending map. Mode
changes are serialized while evaluating pending requests. An unresolved request
outside the review policy remains actionable and its inline card explicitly
explains that review mode still requires confirmation for that command or scope.

Approval telemetry includes `mode` and records `approved_by_policy`,
`approved_once` or `approved_for_task` separately. Nonzero command exit status is
still an execution failure after admission, not an approval rejection. Common
read-only codesign verbosity levels (1–4) and `xattr -l` are recognized; `xattr`
mutations, unrecognized process commands, TCC database queries, arbitrary broad
path grants and unknown commands continue to require manual consent.

A later diagnostic reported mode=review but repeated manual approvals because
app-metadata calls included processInfo and the initial reviewer did not cover
keyed/multiple PlistBuddy Print operations, stat, spctl or System app controls.
A fixture replays all nine observed request shapes against isolated bundle paths.
It also rejects PlistBuddy mutation/command sequences and write/network grants.
Discovery guidance instructs the model to request processInfo only for actual
process inspection, instead of adding it to every metadata command.

### Avoiding unnecessary confirmation for invalid and routine requests

The unified provider contract includes `preflight`, a bounded local validation
hook. Registry admission calls it before authorization. An invalid invocation
still produces an observed failed tool card and body-free diagnostics, but never
requests permission or dispatches to the provider. Hosts validate the binding,
request support, reason and canonical permission paths here. Validation is repeated
at enforcement; preflight is not an access grant and does not remove TOCTOU checks.
This prevents approval cards for paths that do not exist or remote permission
requests that the selected transport cannot support.

Read-only metadata profiles also cover stat format/time options (`-f`, `-t`),
nonrecursive `ls -1`, codesign requirement display (`-r-`) and selected ps process
identity columns. Missing targets under an existing canonical bundle grant can
report absence without a new approval; symlink aliases remain ineligible. The
reviewer continues to require manual consent for privacy databases, keychain
operations, unsupported cryptographic commands and arbitrary private directories.
These calls must not become implicitly allowed just because prior app metadata
calls were reviewed automatically.

### Cancellation precedence

When cancellation and a backend result become ready together, tool execution
prioritizes cancellation and gives the backend a bounded cleanup grace period.
A cooperative backend returning success during that grace period does not change
the invocation back to completed. The tool card stays cancelled and the journal
records uncertain effects; callers must inspect effects before retrying. Results
already returned to the caller remain completed.

Approval-mode polling serializes reads and invalidates reads started both before
and during a mode update. A late reply containing the old mode cannot overwrite
a successful update in the picker. This is independent from host admission policy.

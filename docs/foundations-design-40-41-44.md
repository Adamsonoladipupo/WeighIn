# Policy selectors, build provenance, and payload bounds

This document is the design/prototype deliverable for issues #40, #41, and
#44. It deliberately does not change the production policy wire format,
measurement result schema, or transport behavior before maintainer review.

## Issue #40: structured logical selectors

The selector is a structured tuple, never a display-label string:

```json
{
  "fixture_id": "id:payments",
  "logical_id": "id:transfer",
  "function_name": "quote",
  "case_id": "id:large"
}
```

The proposed policy entry contains `selector` plus a metric-to-rule map. The
existing function-wide configuration remains valid and is interpreted as a
legacy selector with only `function_name` populated. Exact matching is on the
canonical tuple fields; omitted fields are not wildcards in the new exact-case
form.

Precedence is deterministic and independent for each metric:

1. global rule;
2. function-wide rule;
3. exact fixture/contract/function/case rule.

The most specific matching rule wins. Absolute limits are evaluated separately
from regression rules and the stricter result is retained. `ignore` is an
explicit terminal rule for that metric; it does not make an unmatched selector
valid. A non-ignored configured selector that matches no BASE/HEAD case is an
error before policy success. Malformed, duplicate, ambiguous, or partially
specified exact selectors are rejected. Runtime contract IDs appear only as
diagnostics in violations and reports.

The report must show the resolved tuple, selected rule, and effective rule
source. Existing unavailable metrics remain fail-closed unless explicitly
ignored, and legacy function-wide configurations continue through the same
exported validator and runtime evaluator.

## Issue #41: versioned build provenance

Each selected artifact gets a provenance record associated with the actual
`BuiltContract`, not merely the fixture declaration:

```json
{
  "schema_version": 1,
  "mode": "default",
  "verification": "verified",
  "package": "contract_test",
  "manifest_sha256": "...",
  "toolchain": { "rust": "...", "stellar": "...", "sdk": "..." },
  "flags": ["--locked", "--optimize=true", "--target=wasm32v1-none"],
  "inputs": { "source_sha256": "...", "cargo_lock_sha256": "..." },
  "output": { "wasm_sha256": "...", "size_bytes": 1234 }
}
```

`mode` is `default`, `custom`, or `prebuilt`. Default builds record resolved
package/manifest, tool versions, target/profile/features, relevant source and
lockfile identities, and output hash. Custom commands are recorded with the
command text hash and `verification: unknown` unless the caller supplies an
independently verified artifact-to-source manifest. Prebuilt artifacts are
`caller-supplied` and never presented as source-verified merely because a
command was logged.

The reviewed implementation plan is to return these records from
`buildForRevision`, attach the selected record to each revision's measurement,
and render it in reports. Existing result interpretation remains valid when
the provenance field is absent. Differing provenance is informational by
default; a future explicit compatibility policy may require matching verified
provenance, in which case comparison fails closed rather than mixing values.
Archived evidence is not rewritten.

## Issue #44: bounded payloads

Limits are derived separately for each layer and recorded with the failure:

| Layer | Bound | Required behavior |
| --- | --- | --- |
| RPC body | configured byte ceiling with documented headroom over supported captures | read chunks, count bytes, cancel response on overflow; do not trust Content-Length |
| JSON/XDR nesting | maximum decoded depth and collection counts | reject before unbounded recursive accumulation |
| snapshot | total entries, key bytes, value bytes, events, and result bytes | reject the complete snapshot; never accept a partial capture |
| native input | serialized stdin byte ceiling | reject before helper execution/materialization |
| native output | stdout byte ceiling and schema limits | classify as transport/resource failure, not unavailable metrics |

The limits must be recorded with protocol, helper/calibration, and source
capture identities. Boundary-equal payloads are accepted; one byte over is
rejected. Missing or misleading `Content-Length` is handled by counting the
stream. A stalled body is terminated by the existing request deadline and is a
transport failure. Malformed XDR, oversized stdin, and incomplete snapshot
assembly all fail closed. No size failure becomes zero or `unavailable`.

The implementation plan is to introduce a bounded reader used by RPC and native
transport, then apply the same accounting to XDR/event/snapshot accumulation.
The native helper's own process limits remain separate; the wrapper cannot claim
to contain an arbitrary hostile executable.

## Prototype and review boundary

`tests/foundations-design.test.cjs` exercises the proposed selector precedence,
unmatched behavior, provenance verification states, and inclusive/exclusive
payload boundaries without changing production behavior or fabricating network
evidence. Maintainer review is required before converting these proposals into
public config/result schemas or transport changes.

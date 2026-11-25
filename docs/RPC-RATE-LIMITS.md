# Troubleshoot Soroban RPC rate limits

HTTP 429 means the endpoint or a gateway is throttling requests. Identify the
RPC method, time, environment, and HTTP status in the run log. Inspect
`Retry-After` and the provider's quota dashboard when available. Record the
provider hostname without URL credentials or tokens. A JSON-RPC error in an
HTTP 200 response can instead come from the request or simulation itself.

## Retry read-only simulation requests

- Start with one simulation at a time per endpoint and cap CI matrix
  concurrency. Account for all jobs sharing a key or IP and check whether the
  provider counts each request in a batch.
- On 429, honor `Retry-After` when supplied. The value can be a number of
  seconds or an HTTP date. Stop if the requested delay exceeds the run's
  remaining retry budget.
- Otherwise use capped exponential backoff with jitter. For example, allow
  four retries after the initial request, with a randomly selected delay
  between zero and the current cap of 1, 2, 4, then 8 seconds. Impose a total
  deadline and a per-request timeout.
- Apply this policy to read-only requests such as `simulateTransaction`.
  Investigate persistent 429s as a quota or concurrency issue. For a timed-out
  transaction submission, look up its hash before deciding whether to submit
  again.

WeighIn has no configurable 429 retry policy for measurement simulation. Its
account-readiness polling and snapshot recovery have separate retry rules.
Configure bounded retries in a caller or a trusted gateway for read-only RPC
methods. If a failed measurement run is retried, rerun the whole comparison
against the same network configuration.

## Choose an endpoint

For general Stellar Mainnet or Testnet RPC clients, compare your provider's
plan quota, burst limits, supported methods, and data retention.

- [Blockdaemon Stellar Soroban RPC](https://docs.blockdaemon.com/docs/access-soroban-rpc)
  offers authenticated Mainnet and Testnet endpoints.
- [QuickNode Stellar RPC](https://www.quicknode.com/docs/stellar/api-overview)
  offers Mainnet and Testnet endpoints. [Its Stellar endpoint guide](https://www.quicknode.com/docs/stellar/endpoints)
  documents URL tokens and plan-dependent limits.

For WeighIn benchmarks, use its supported protocol-28 standalone network.
Provision an isolated Stellar Quickstart instance per CI job to avoid shared
public-node quotas, or use a compatible private standalone endpoint. Set the
Action's `rpc-url` input or the CLI's `--rpc-url` flag. A hosted Mainnet or
Testnet URL does not satisfy WeighIn's standalone network requirements.
See [RPC authentication](RPC-AUTH.md) for storing URL tokens and header
credentials.

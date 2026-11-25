# Authenticate Soroban RPC requests

Use an API key or Bearer token when your RPC provider requires it. The examples
below use a read-only `getHealth` request. WeighIn's Action and measurement CLI
currently accept an endpoint URL and require a compatible standalone network.
They do not consume `SOROBAN_RPC_HEADER_AUTHORIZATION` directly. For a private
standalone endpoint with header authentication, point `rpc-url` or `--rpc-url`
at a trusted gateway that inserts the provider's headers and forwards both RPC
and account-funding requests.

## Local requests

1. Copy the HTTPS endpoint for the network you intend to query. For example,
   [Blockdaemon documents Soroban endpoints and both header formats](https://docs.blockdaemon.com/docs/access-soroban-rpc).
   [QuickNode documents Stellar endpoints with a token in the URL](https://www.quicknode.com/docs/stellar/endpoints).
2. Load the URL and credentials into your environment from your secret store.
   For Bearer authentication, set `SOROBAN_RPC_HEADER_AUTHORIZATION` to the
   complete value, including `Bearer `. Keep shell tracing disabled.
3. Send a read-only probe. The client explicitly maps the environment value
   to the HTTP header.

```bash
curl --silent --show-error --fail-with-body --max-time 15 \
  --header 'Content-Type: application/json' \
  --header "Authorization: ${SOROBAN_RPC_HEADER_AUTHORIZATION:?missing Bearer value}" \
  --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  "${SOROBAN_RPC_URL:?missing RPC URL}"
```

If your provider specifies `X-API-Key`, store the raw key in
`SOROBAN_RPC_HEADER_X_API_KEY` and replace the Authorization option with
`--header "X-API-Key: ${SOROBAN_RPC_HEADER_X_API_KEY:?missing API key}"`.
For a token in the endpoint path, omit the Authorization option and treat the
complete URL as a secret. Check the JSON-RPC result as well as the HTTP status.

## GitHub Actions

Under **Settings → Secrets and variables → Actions**, create
`SOROBAN_RPC_URL` and `SOROBAN_RPC_TOKEN`. Store the raw token in the latter.
Run this step in a trusted workflow with access to those secrets.

```yaml
- name: Check authenticated Soroban RPC
  env:
    SOROBAN_RPC_URL: ${{ secrets.SOROBAN_RPC_URL }}
    SOROBAN_RPC_HEADER_AUTHORIZATION: Bearer ${{ secrets.SOROBAN_RPC_TOKEN }}
  shell: bash
  run: |
    test -n "$SOROBAN_RPC_URL"
    test "$SOROBAN_RPC_HEADER_AUTHORIZATION" != 'Bearer '
    curl --silent --show-error --fail --max-time 15 \
      --header 'Content-Type: application/json' \
      --header "Authorization: $SOROBAN_RPC_HEADER_AUTHORIZATION" \
      --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      "$SOROBAN_RPC_URL" | python3 -c 'import json, sys; sys.exit(json.load(sys.stdin).get("result", {}).get("status") != "healthy")'
```

Fork pull requests generally lack access to repository secrets. Keep provider
tokens out of fixture files and logs. If the response is HTTP 401 or 403, check
the credential format, network, and endpoint permissions. For HTTP 429, see
[RPC rate limits](RPC-RATE-LIMITS.md).

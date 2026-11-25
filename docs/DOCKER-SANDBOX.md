# Running WeighIn with a local Soroban sandbox

WeighIn can run in offline CI environments without external Testnet RPCs by using the
`stellar/quickstart` Docker image as a local Soroban network.

## GitHub Actions service container

Add a service container to the benchmark job:

```yaml
jobs:
  benchmark:
    runs-on: ubuntu-latest
    services:
      stellar:
        image: stellar/quickstart:v28
        ports:
          - 8000:8000
        options: >-
          --health-cmd "curl --fail http://localhost:8000/"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 12
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
```

Then configure the job to use the containerized RPC at `http://stellar:8000`.
Use the network passphrase and RPC URL from the quickstart container's selected local
network mode. Confirm that fixtures and source accounts are compatible with that mode
before running a benchmark.

## Run quickstart locally

```bash
docker run --rm -it \
  --publish 8000:8000 \
  stellar/quickstart:v28 \
  --local
```

Keep the container running while WeighIn invokes Stellar RPCs. Set `RPC_URL` only when
the repository's command or workflow configuration requires an override.

## Offline considerations

- Pull the `stellar/quickstart` image before disabling external network access.
- Pin the quickstart image tag or digest for reproducible CI.
- Keep Stellar CLI, Rust, Node.js, and native-helper dependencies cached.
- Do not assume `standalone`, `testnet`, or `futurenet` uses the same network
  passphrase or protocol configuration.
- Use [network readiness](network-readiness.md) checks and the repository's local
  workflow scripts instead of immediate RPC calls.
- Record protocol and compute configuration provenance with benchmark results.

For the repository's supported local-network workflow, see
[network readiness](network-readiness.md) and
[contract build setup](contract-build.md).

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-26

### Added

- Soroban transaction simulation benchmarking: configured contract functions are
  simulated and their resource usage (CPU cost-model instructions, memory,
  footprint, ledger write entries/bytes) is measured with a protocol-matched
  native simulation (protocol 28, Soroban SDK 28.0.0, Stellar CLI 28.1.0,
  Rust 1.95.0).
- Base vs Head git worktree comparison: each pull request is benchmarked in an
  independently checked-out BASE worktree and the HEAD workspace, with logical
  benchmarks paired by stable fixture IDs across revisions.
- Markdown PR comment reporting: benchmark results are posted as a Markdown
  comment on the pull request, including a per-metric BASE / HEAD / delta table.
- Threshold enforcement via `weighin.toml`: regression thresholds and absolute
  resource caps (including `strict_zero_tolerance`) fail the GitHub Action
  when violated.

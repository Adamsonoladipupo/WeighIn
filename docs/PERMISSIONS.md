# GitHub Actions Permissions

WeighIn uses two separate GitHub Actions workflows:

1. `weighin.yml` measures contract resource usage and uploads the report.
2. `weighin-comment.yml` downloads the report and posts the pull request comment.

Separating these workflows allows the benchmark workflow to use read-only
permissions while the comment workflow receives only the permissions required
to publish a comment.

## 1. Producer workflow: weighin.yml

The producer runs on `pull_request` and executes the benchmark.

It does not need permission to write pull request comments.

Use this permission block:

```yaml
permissions:
  contents: read

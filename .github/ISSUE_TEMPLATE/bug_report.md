---
name: Bug report
about: Report a bug in WeighIn calculations, CLI execution, or contract handling
title: '[BUG] '
labels: bug
assignees: ''

body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report a bug! Please fill out the form below as completely as possible.

  - type: input
    id: version
    attributes:
      label: WeighIn version
      description: Which version of WeighIn are you using? Run `weighin --version` or check `package.json`.
      placeholder: ex. 1.2.3
    validations:
      required: true

  - type: dropdown
    id: os
    attributes:
      label: Operating system
      multiple: false
      options:
        - Windows
        - macOS
        - Linux
    validations:
      required: true

  - type: input
    id: node-version
    attributes:
      label: Node.js version
      description: Output of `node --version`.
      placeholder: ex. v20.11.0
    validations:
      required: true

  - type: textarea
    id: description
    attributes:
      label: Describe the bug
      description: A clear and concise description of what the bug is.
      placeholder: Tell us what went wrong...
    validations:
      required: true

  - type: textarea
    id: reproduction
    attributes:
      label: Reproduction steps
      description: Provide the smallest set of steps or inputs that reliably reproduces the issue.
      placeholder: |
        1. Run `weighin ...` with ...
        2. Observe ...
      value: |
        1.
        2.
        3.
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      description: What did you expect to happen?
      placeholder: Tell us what should have happened...
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
      description: What happened instead? For calculation discrepancies, include input values and expected versus actual results.
      placeholder: Tell us what actually happened...
    validations:
      required: true

  - type: textarea
    id: logs
    attributes:
      label: Logs or output
      description: Paste relevant CLI output or logs here. Remove secrets and private keys before posting.
      render: shell
      placeholder: Paste logs or command output here...
    validations:
      required: false

  - type: textarea
    id: config
    attributes:
      label: Configuration
      description: Relevant `weighin.toml` or contract configuration (remove secrets).
      render: toml
      placeholder: Paste your configuration here...
    validations:
      required: false

  - type: textarea
    id: additional-context
    attributes:
      label: Additional context
      description: Add any other context, screenshots, or sample data that may help diagnose the issue.
      placeholder: Add context here...
    validations:
      required: false

  - type: checkboxes
    id: terms
    attributes:
      label: Code of Conduct
      description: By submitting this issue, you agree to follow our Code of Conduct
      options:
        - label: I agree to follow this project's Code of Conduct
          required: true

---
name: Feature request
about: Suggest an idea or enhancement for WeighIn
title: '[FEATURE] '
labels: enhancement
assignees: ''

body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting a feature! Please fill out the form below to help us understand your request.

  - type: textarea
    id: problem
    attributes:
      label: Is your feature request related to a problem? Please describe.
      description: A clear and concise description of the problem. Ex. I'm always frustrated when [...]
      placeholder: Describe the problem...
    validations:
      required: true

  - type: textarea
    id: proposed-outcome
    attributes:
      label: Describe the proposed outcome
      description: A clear and concise description of what you want to happen and how it works.
      placeholder: Describe the proposed feature...
    validations:
      required: true

  - type: textarea
    id: why-matters
    attributes:
      label: Why it matters
      description: Explain how this feature improves the workflow for Soroban/Stellar developers using WeighIn.
      placeholder: Explain why this is valuable...
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Describe alternatives you've considered
      description: A clear and concise description of any alternative solutions or features you've considered.
      placeholder: Describe alternatives...
    validations:
      required: false

  - type: dropdown
    id: priority
    attributes:
      label: How important is this to you?
      multiple: false
      options:
        - "Nice to have"
        - "Important"
        - "Critical / blocking my workflow"
    validations:
      required: false

  - type: textarea
    id: additional-context
    attributes:
      label: Additional context
      description: Add any other context or screenshots about the feature request here.
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

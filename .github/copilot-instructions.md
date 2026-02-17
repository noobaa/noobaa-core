# GitHub Copilot Code Review Instructions

## Review Philosophy
- Only comment when you have HIGH CONFIDENCE (>80%) that an issue exists
- Be concise: one sentence per comment when possible
- Focus on actionable feedback, not observations

## External Resources to be Familiar With
- NooBaa operator repository
- AWS api reference for relevant areas (S3, IAM, etc.)

## Priority Areas (Review These)

### Correctness Issues
- Logic errors that could cause incorrect behavior
- Race conditions in async code
- Incorrect error propagation

### Architecture & Patterns
- Code that violates existing patterns in the codebase
- Missing error handling

## Performance
- Performance degradation potential in I/O flows
- Redundent looping
- Multiple trips to the DB instead of batching/aggregating
- Bottleneck potentials
- Unnecessary data processing


### Test Coverage
- Low test coverage added to the new code in the PR
- Suggest more test cases (descriptions, not code) to be added

## CI Pipeline Context

**Important**: You review PRs immediately, before CI completes.

## Skip These (Low Value)

Do not comment on:
- **Style/formatting**
- **Minor naming suggestions** - unless truly confusing
- **Suggestions to add comments** - for self-documenting code
- **Refactoring suggestions** - unless there's a clear bug, maintainability or a performance issue
- **Multiple issues in one comment** - choose the single most critical issue
- **Logging suggestions** - unless for errors or security events (the codebase needs less logging which is more focused and valuable, not more)

## Response Format

When you identify an issue:
1. **State the problem** (1 sentence)
2. **Why it matters** (1 sentence, only if not obvious)
3. **Suggested fix** (code snippet or specific action)

Example:
```
This could error req.body.vectorBucketName is empty. Consider validating it exists before using it.
```

## When to Stay Silent

If you're uncertain whether something is an issue, don't comment. False positives create noise and reduce trust in the review process.

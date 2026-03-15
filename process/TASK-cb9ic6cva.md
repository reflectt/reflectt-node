# TASK-cb9ic6cva — test(insights): auto-tagger regression tests

PR #1046: https://github.com/reflectt/reflectt-node/pull/1046

- 9 regression tests for deployment misclassification batch-2 cases
- Bonus fix: `stall.+pr` → `stall.+\bprs?\b` (word-bounded, plural-aware)
- 50/50 tests pass

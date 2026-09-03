# NodeFlow Experiments

实验分支用于探索尚未验证的产品、交互或技术方案。

## Branch Model

- `main` = Stable Product
- `next` = Experimental Integration / Preview
- `experiment/*` = Temporary Laboratory

## Rules

- Experiment may fail.
- Experiment code is not automatically mergeable.
- Every experiment must be reviewed before entering `main`.
- A successful product experiment may still require clean reimplementation before merge.

## NodeFlow Protected Semantics

Experiments may challenge these rules, but cannot permanently change them without an Architecture Review:

- **Document**: Do not change the persistence format for an experiment. New schemas require a separate migration / compatibility review.
- **Geometry**: `node.position` remains the single source of truth for Canvas geometry.
- **Stage**: New features must not change Stage membership / bounds / movement / containment semantics without a design review.
- **Participant**: `Participant assignment ≠ spatial parenting`.
- **Swimlane**: `Swimlane = optional visual organization; Swimlane ≠ persistent spatial parent`. Do not reintroduce `laneId` / `laneBindingId`.

See [CODEBUDDY_EXPERIMENT_RULES.md](./CODEBUDDY_EXPERIMENT_RULES.md) for the full rules.

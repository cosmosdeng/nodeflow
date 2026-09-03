# CodeBuddy Experiment Rules

This document governs how CodeBuddy (or any AI agent) creates, runs, and closes
experimental work on the NodeFlow repository.

## 1. Branch Roles

- `main` is the stable zone. Never modify `main` history.
- `next` is the experimental integration / preview branch.
- `experiment/*` branches are temporary laboratories. They may fail and be discarded.

## 2. Failure Is Allowed

`experiment/*` code may fail. A failed experiment is a valid outcome.
Discard it; do not force it into `next` or `main`.

## 3. Experiment Code Is Not Production Code

Code written on `experiment/*` is exploratory. It does not automatically meet
production quality, test, or architecture standards.

## 4. Separate Validations

Product validation and Architecture validation are separate decisions.

## 5. Accept Product, Reject Architecture

It is a valid outcome to accept a product result while rejecting its architecture
implementation. In that case: keep the product conclusion, discard the code, and
re-implement cleanly on the stable architecture.

## 6. No Unnecessary Architecture Expansion

Do not grow the architecture for the sake of a single feature. Avoid introducing
new Manager / Service / Repository / Factory / Adapter / Event Bus / DI /
Plugin Framework layers without explicit architectural review.

## 7. No Automatic Merge

Experiments must never auto-merge. Every entry into `next` or `main` requires an
explicit decision documented in the experiment record.

## 8. Explicit Decision Gates

Entering `next` or `main` requires:

- A documented product review.
- A documented architecture review.
- The project's existing verification commands passing (test / typecheck / build / lint).
- No unnecessary architecture layers, no Document Model / persistence / geometry /
  Stage / Participant / Swimlane semantic violations.

## NodeFlow Protected Semantics

- **Document**: do not change the persistence format without a migration /
  compatibility review.
- **Geometry**: `node.position` is the single source of truth for Canvas geometry.
- **Stage**: preserve Stage membership, bounds, movement, containment semantics.
- **Participant**: assignment is not spatial parenting.
- **Swimlane**: optional visual organization; not a persistent spatial parent.
  Do not reintroduce `laneId` / `laneBindingId` without a new architecture design.

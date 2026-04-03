# Workflow Daily Steps

## Standard feature

```bash
/bs:dev my-feature
# ... code ...
/bs:test --watch
/bs:quality
```

## Merge path

```bash
/bs:dev my-feature
# ... code ...
/bs:quality --merge
```

## Planned task

```bash
/bs:plan
/bs:dev implementation-step
/bs:quality
```

## Backlog work

```bash
/bs:backlog
/bs:ralph
```

## Hotfix

```bash
/bs:hotfix issue-description
```

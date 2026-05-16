---
name: deps
description: Dependency health — outdated packages, security audit, smart upgrades
triggers:
  - "outdated.*dep"
  - "outdated.*package"
  - "security.*audit"
  - "vulnerabilit"
  - "check.*dep"
  - "upgrade.*dep"
  - "npm.*audit"
---

# Dependencies Skill

When triggered, run `/bs:deps` to check dependency health.

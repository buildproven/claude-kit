---
name: open-source-prep
description: "Auto-invoke when user mentions releasing, scrubbing, or cleaning a project for any distribution: open source, selling, giving away, making public, or preparing for release. Also activates on 'scrub', 'clean for release', 'prep for sale', 'set repo public', 'MIT license', 'remove private info', or any variation. Routes to /bs:scrub for the unified workflow."
---

# Release Scrub Skill

Detects when a project needs scrubbing/cleaning for any type of release and routes to the unified `/bs:scrub` command.

## When This Activates

**Open Source / Giveaway triggers:**

- User mentions making a repo public or open source
- User says "set to public", "go public", "open source this"
- User mentions removing private info, secrets, or internal files
- User asks about MIT/Apache/GPL licensing
- User mentions "give away" or "free download"

**Commercial / Sell triggers:**

- User says "prep for sale", "clean for selling", "package for customers"
- User mentions commercial license, EULA, or selling a product
- User says "scrub for release", "clean for distribution"

**General triggers:**

- User says "scrub", "clean for release", "prep for release"
- User mentions launch prep for any distribution type

## What To Do

1. **Check for execution receipt first:**

   ```bash
   cat .scrub.log 2>/dev/null || cat .open-source-prep.log 2>/dev/null
   ```

   If a receipt exists and is recent, inform the user and show results.

2. **Determine mode from context:**
   - "open source", "public repo", "contributions" -> `opensource`
   - "sell", "commercial", "customers", "EULA" -> `sell`
   - "give away", "free", "no contributions" -> `giveaway`
   - Unclear -> ask the user

3. **Quick pre-flight check:**

   ```bash
   git ls-files -- CLAUDE.md BACKLOG.md AGENTS.md ROADMAP.md .serena .claude .qualityrc.json pricing.config.* 2>/dev/null
   ```

   If any exist, flag immediately.

4. **Invoke `/bs:scrub`** via the Skill tool with the determined mode.

## Backward Compatibility

The old `/open-source-prep` command still exists and works. `/bs:scrub --mode opensource` is equivalent. Both produce execution receipts (`.scrub.log` for the new command, `.open-source-prep.log` for the old).

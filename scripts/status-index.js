#!/usr/bin/env node
/**
 * Status Index Generator and Reader
 *
 * Generates and reads .status-index.json for efficient project status queries.
 * Used by /sync-private (write) and /project-status (read).
 */

const fs = require("fs");
const path = require("path");

/**
 * Extract version from README.md
 */
function extractVersion(readmeContent) {
  const versionMatch =
    readmeContent.match(/v(\d+\.\d+\.\d+)/i) ||
    readmeContent.match(/version[:\s]+(\d+\.\d+\.\d+)/i);
  return versionMatch ? versionMatch[1] : "unknown";
}

/**
 * Extract current focus from README.md
 */
function extractFocus(readmeContent) {
  const focusMatch = readmeContent.match(
    /(?:Current Status|Focus).*?\n.*?-(.*?)$/im,
  );
  return focusMatch ? focusMatch[1].trim() : "See README.md";
}

/**
 * Extract sprint info from current-sprint.md
 */
function extractSprintInfo(sprintContent) {
  const goalMatch = sprintContent.match(/\*\*Goal\*\*:?\s*(.+)/i);
  const statusMatch = sprintContent.match(/\*\*Status\*\*:?\s*(.+)/i);
  const durationMatch = sprintContent.match(/\*\*Duration\*\*:?\s*(.+)/i);

  return {
    goal: goalMatch ? goalMatch[1].trim() : "Not specified",
    status: statusMatch ? statusMatch[1].trim() : "Unknown",
    duration: durationMatch ? durationMatch[1].trim() : "Unknown",
    recent_entries: extractRecentSprintEntries(sprintContent, 3),
  };
}

/**
 * Extract last N sprint daily entries
 */
function extractRecentSprintEntries(sprintContent, n = 3) {
  const entries = [];
  const lines = sprintContent.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match date headers like "### 2025-11-16 (Saturday)"
    const dateMatch = line.match(/^###\s+(\d{4}-\d{2}-\d{2})\s+\((\w+)\)/);
    if (dateMatch) {
      const date = dateMatch[1];
      const day = dateMatch[2];
      const entryLines = [];

      // Collect lines until next date or section
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].match(/^###/) || lines[j].match(/^##/)) break;
        if (lines[j].trim()) entryLines.push(lines[j].trim());
      }

      entries.push({
        date,
        day,
        summary: entryLines.slice(0, 3).join(" "), // First 3 lines
      });

      if (entries.length >= n) break;
    }
  }

  return entries;
}

/**
 * Count items by priority in backlog.md
 */
function countBacklogItems(backlogContent) {
  const p0Match = backlogContent.match(
    /## 🚨 P0 - Critical.*?\n([\s\S]*?)(?=\n##)/,
  );
  const p1Match = backlogContent.match(
    /## ⚠️ P1 - Important.*?\n([\s\S]*?)(?=\n##)/,
  );
  const p2Match = backlogContent.match(
    /## 📋 P2 - Recommended.*?\n([\s\S]*?)(?=\n##)/,
  );

  const countItems = (section) => {
    if (!section) return 0;
    const items = section.match(/^-\s+\*\*/gm);
    return items ? items.length : 0;
  };

  return {
    p0: countItems(p0Match ? p0Match[1] : ""),
    p1: countItems(p1Match ? p1Match[1] : ""),
    p2: countItems(p2Match ? p2Match[1] : ""),
  };
}

/**
 * Extract top N backlog items
 */
function extractTopBacklogItems(backlogContent, n = 5) {
  const items = [];
  const lines = backlogContent.split("\n");

  for (const line of lines) {
    const itemMatch = line.match(/^-\s+\*\*([A-Z]+-\d+)\*\*\s+\|\s+(.+?)\s+\|/);
    if (itemMatch && items.length < n) {
      items.push({
        id: itemMatch[1],
        title: itemMatch[2].trim(),
      });
    }
  }

  return items;
}

/**
 * Extract recently completed items
 */
function extractRecentCompleted(backlogContent, n = 5) {
  const completed = [];
  const completedSection = backlogContent.match(
    /## Completed ✅([\s\S]*?)(?=\n##|$)/,
  );

  if (completedSection) {
    const lines = completedSection[1].split("\n");
    for (const line of lines) {
      const itemMatch = line.match(
        /^-\s+\*\*([A-Z]+-\d+)\*\*\s+\|\s+(.+?)\s+\|\s+(.+?)\s+\|/,
      );
      if (itemMatch && completed.length < n) {
        completed.push({
          id: itemMatch[1],
          title: itemMatch[2].trim(),
          date: itemMatch[3].trim(),
        });
      }
    }
  }

  return completed;
}

/**
 * Generate .status-index.json from markdown files
 */
function generateIndex(projectDir) {
  const readmePath = path.join(projectDir, "README.md");
  const backlogPath = path.join(projectDir, "backlog.md");
  const sprintPath = path.join(projectDir, "planning", "current-sprint.md");

  // Read files
  const readmeContent = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, "utf8")
    : "";
  const backlogContent = fs.existsSync(backlogPath)
    ? fs.readFileSync(backlogPath, "utf8")
    : "";
  const sprintContent = fs.existsSync(sprintPath)
    ? fs.readFileSync(sprintPath, "utf8")
    : "";

  // Build index
  const index = {
    project: path.basename(projectDir),
    version: extractVersion(readmeContent),
    last_updated: new Date().toISOString().split("T")[0], // YYYY-MM-DD
    focus: extractFocus(readmeContent),

    sprint: extractSprintInfo(sprintContent),

    backlog: {
      counts: countBacklogItems(backlogContent),
      top_items: extractTopBacklogItems(backlogContent, 5),
      recent_completed: extractRecentCompleted(backlogContent, 5),
    },
  };

  return index;
}

/**
 * Write status index to file
 */
function writeIndex(projectDir, index) {
  const indexPath = path.join(projectDir, ".status-index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  return indexPath;
}

/**
 * Read status index from file
 */
function readIndex(projectDir) {
  const indexPath = path.join(projectDir, ".status-index.json");
  if (!fs.existsSync(indexPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (e) {
    console.error(`Failed to parse ${indexPath}: ${e.message}`);
    return null;
  }
}

// CLI Usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const projectDir = args[1] || process.cwd();

  if (command === "generate") {
    const index = generateIndex(projectDir);
    const indexPath = writeIndex(projectDir, index);
    console.log(`✅ Generated: ${indexPath}`);
    console.log(JSON.stringify(index, null, 2));
  } else if (command === "read") {
    const index = readIndex(projectDir);
    if (index) {
      console.log(JSON.stringify(index, null, 2));
    } else {
      console.error("❌ No status index found");
      process.exit(1);
    }
  } else {
    console.error("Usage: status-index.js [generate|read] [project-dir]");
    process.exit(1);
  }
}

module.exports = {
  generateIndex,
  writeIndex,
  readIndex,
  extractVersion,
  extractFocus,
  extractRecentSprintEntries,
  countBacklogItems,
  extractTopBacklogItems,
  extractRecentCompleted,
};

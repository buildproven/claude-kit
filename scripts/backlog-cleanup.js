#!/usr/bin/env node
/**
 * backlog-cleanup.js
 *
 * Scans a BACKLOG.md file (or all active repos) and:
 *  1. Finds rows in active sections where Status = ✅ <date> or Done/done
 *  2. Removes the entire ### CS-XXX: section block from the active area
 *  3. Appends a 4-column row to ## Completed
 *  4. Updates the "Active Backlog (N pending items)" header count
 *
 * Usage:
 *   node scripts/backlog-cleanup.js [path/to/BACKLOG.md]
 *   node scripts/backlog-cleanup.js --all   (scans ~/Projects/* for BACKLOG.md)
 *   node scripts/backlog-cleanup.js --dry-run
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const all = args.includes("--all");

function cleanupBacklog(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP: ${filePath} not found`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  // --- 1. Find all active-section rows that are done ---
  const completedItems = []; // { id, item, type, date }
  const completedLineNums = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("| CS-")) continue;
    const parts = line
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p);
    if (parts.length < 7) continue;

    const [id, item, type, , , , status] = parts;
    const isDone = status.includes("✅") || status.toLowerCase() === "done";

    if (!isDone) continue;

    const dateMatch = status.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch
      ? dateMatch[1]
      : new Date().toISOString().split("T")[0];
    completedItems.push({
      id: id.trim(),
      item: item.trim(),
      type: type.trim(),
      date,
    });
    completedLineNums.add(i);
  }

  if (completedItems.length === 0) {
    console.log(`  OK: ${filePath} — nothing to clean up`);
    return;
  }

  console.log(`  FIXING: ${filePath} — ${completedItems.length} items to move`);

  // --- 2. Remove entire ### CS-XXX: section blocks for completed items ---
  const completedIds = new Set(completedItems.map((c) => c.id));

  // Find all section block boundaries
  // A section = ### CS-XXX: ... up to (not including) the next ### CS or ## heading or end
  const filteredLines = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Check if this is a section heading for a completed item
    const sectionMatch = line.match(/^### (CS-\d+):/);
    if (sectionMatch && completedIds.has(sectionMatch[1])) {
      // Skip until next section heading or end of active section
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next.startsWith("### CS-") || next.startsWith("## ")) {
          break; // stop — don't consume this line
        }
        i++;
      }
      continue;
    }

    filteredLines.push(line);
    i++;
  }

  // --- 3. Update the "Active Backlog (N pending items)" count ---
  // Count truly active items remaining (non-completed data rows)
  let pendingCount = 0;
  for (const line of filteredLines) {
    if (!line.startsWith("| CS-")) continue;
    const parts = line
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p);
    if (parts.length < 7) continue;
    const status = parts[6];
    if (!status.includes("✅") && status.toLowerCase() !== "done") {
      pendingCount++;
    }
  }

  const newContent_step1 = filteredLines
    .join("\n")
    .replace(
      /## Active Backlog \(\d+ pending items\)/,
      `## Active Backlog (${pendingCount} pending items)`,
    );

  // --- 4. Append to ## Completed in 4-column format ---
  let newContent = newContent_step1;

  // Check if Completed section exists
  if (newContent.includes("## Completed")) {
    // Insert new rows after the Completed table header line
    const completedSectionIdx = newContent.indexOf("\n## Completed");
    // Find the table header row in Completed section
    const afterCompleted = newContent.indexOf(
      "\n| --- | --- | --- | --- |",
      completedSectionIdx,
    );
    if (afterCompleted !== -1) {
      const insertAt = afterCompleted + "\n| --- | --- | --- | --- |".length;
      const newRows =
        "\n" +
        completedItems
          .map(
            (c) =>
              `| ${c.id} | ${c.item.substring(0, 70)} | ${c.type} | ${c.date} |`,
          )
          .join("\n");
      newContent =
        newContent.substring(0, insertAt) +
        newRows +
        newContent.substring(insertAt);
    } else {
      // No table header found, add it
      const insertAt =
        newContent.indexOf("\n## Completed") + "\n## Completed".length;
      const rows = completedItems
        .map(
          (c) =>
            `| ${c.id} | ${c.item.substring(0, 70)} | ${c.type} | ${c.date} |`,
        )
        .join("\n");
      newContent =
        newContent.substring(0, insertAt) +
        "\n\n| ID | Item | Type | Completed |\n| --- | --- | --- | --- |\n" +
        rows +
        newContent.substring(insertAt);
    }
  } else {
    // No Completed section at all — append it
    const rows = completedItems
      .map(
        (c) =>
          `| ${c.id} | ${c.item.substring(0, 70)} | ${c.type} | ${c.date} |`,
      )
      .join("\n");
    newContent += `\n## Completed\n\n| ID | Item | Type | Completed |\n| --- | --- | --- | --- |\n${rows}\n`;
  }

  if (dryRun) {
    console.log(`  DRY RUN — would write ${newContent.length} chars`);
    completedItems.forEach((c) =>
      console.log(`    → ${c.id}: ${c.item.substring(0, 50)}`),
    );
    return;
  }

  fs.writeFileSync(filePath, newContent, "utf8");
  console.log(
    `  ✅ Done — moved ${completedItems.length} items to Completed, ${pendingCount} active remain`,
  );
}

// --- Main ---
if (all) {
  const projectsDir = path.join(os.homedir(), "Projects");
  const dirs = fs.readdirSync(projectsDir);
  for (const dir of dirs) {
    const candidate = path.join(projectsDir, dir, "BACKLOG.md");
    if (fs.existsSync(candidate)) {
      process.stdout.write(`${dir}: `);
      cleanupBacklog(candidate);
    }
  }
} else {
  const target = args.find((a) => !a.startsWith("--")) || "BACKLOG.md";
  cleanupBacklog(target);
}

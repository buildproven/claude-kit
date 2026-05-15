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

const fs = require('fs')
const path = require('path')
const os = require('os')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const all = args.includes('--all')

function makeCompletedRows(items) {
  return items
    .map(
      c => `| ${c.id} | ${c.item.substring(0, 70)} | ${c.type} | ${c.date} |`
    )
    .join('\n')
}

function appendToCompleted(content, completedItems) {
  const rows = makeCompletedRows(completedItems)
  if (!content.includes('## Completed')) {
    return (
      content +
      `\n## Completed\n\n| ID | Item | Type | Completed |\n| --- | --- | --- | --- |\n${rows}\n`
    )
  }

  const sectionIdx = content.indexOf('\n## Completed')
  const headerSep = '\n| --- | --- | --- | --- |'
  const afterHeader = content.indexOf(headerSep, sectionIdx)

  if (afterHeader !== -1) {
    const insertAt = afterHeader + headerSep.length
    return (
      content.substring(0, insertAt) + '\n' + rows + content.substring(insertAt)
    )
  }

  const insertAt = sectionIdx + '\n## Completed'.length
  return (
    content.substring(0, insertAt) +
    '\n\n| ID | Item | Type | Completed |\n| --- | --- | --- | --- |\n' +
    rows +
    content.substring(insertAt)
  )
}

function findCompletedItems(lines) {
  const completedItems = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('| CS-')) continue
    const parts = line
      .split('|')
      .map(p => p.trim())
      .filter(p => p)
    if (parts.length < 7) continue
    const [id, item, type, , , , status] = parts
    if (!status.includes('✅') && status.toLowerCase() !== 'done') continue
    const dateMatch = status.match(/(\d{4}-\d{2}-\d{2})/)
    const date = dateMatch
      ? dateMatch[1]
      : new Date().toISOString().split('T')[0]
    completedItems.push({
      id: id.trim(),
      item: item.trim(),
      type: type.trim(),
      date,
    })
  }
  return completedItems
}

function countPendingItems(lines) {
  let count = 0
  for (const line of lines) {
    if (!line.startsWith('| CS-')) continue
    const parts = line
      .split('|')
      .map(p => p.trim())
      .filter(p => p)
    if (parts.length < 7) continue
    const status = parts[6]
    if (!status.includes('✅') && status.toLowerCase() !== 'done') count++
  }
  return count
}

function removeCompletedSections(lines, completedIds) {
  const filtered = []
  let i = 0
  while (i < lines.length) {
    const sectionMatch = lines[i].match(/^### (CS-\d+):/)
    if (sectionMatch && completedIds.has(sectionMatch[1])) {
      i++
      while (
        i < lines.length &&
        !lines[i].startsWith('### CS-') &&
        !lines[i].startsWith('## ')
      ) {
        i++
      }
      continue
    }
    filtered.push(lines[i])
    i++
  }
  return filtered
}

function cleanupBacklog(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP: ${filePath} not found`)
    return
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')

  const completedItems = findCompletedItems(lines)

  if (completedItems.length === 0) {
    console.log(`  OK: ${filePath} — nothing to clean up`)
    return
  }

  console.log(`  FIXING: ${filePath} — ${completedItems.length} items to move`)

  const completedIds = new Set(completedItems.map(c => c.id))
  const filteredLines = removeCompletedSections(lines, completedIds)
  const pendingCount = countPendingItems(filteredLines)

  const newContent_step1 = filteredLines
    .join('\n')
    .replace(
      /## Active Backlog \(\d+ pending items\)/,
      `## Active Backlog (${pendingCount} pending items)`
    )

  // --- 4. Append to ## Completed in 4-column format ---
  let newContent = appendToCompleted(newContent_step1, completedItems)

  if (dryRun) {
    console.log(`  DRY RUN — would write ${newContent.length} chars`)
    completedItems.forEach(c =>
      console.log(`    → ${c.id}: ${c.item.substring(0, 50)}`)
    )
    return
  }

  fs.writeFileSync(filePath, newContent, 'utf8')
  console.log(
    `  ✅ Done — moved ${completedItems.length} items to Completed, ${pendingCount} active remain`
  )
}

// --- Main ---
if (all) {
  const projectsDir = path.join(os.homedir(), 'Projects')
  const dirs = fs.readdirSync(projectsDir)
  for (const dir of dirs) {
    const candidate = path.join(projectsDir, dir, 'BACKLOG.md')
    if (fs.existsSync(candidate)) {
      process.stdout.write(`${dir}: `)
      cleanupBacklog(candidate)
    }
  }
} else {
  const target = args.find(a => !a.startsWith('--')) || 'BACKLOG.md'
  cleanupBacklog(target)
}

#!/usr/bin/env node

/**
 * Risk Policy Gate - Carson's Code Factory Pattern
 *
 * Validates PR changes against risk-aware merge policy before expensive CI.
 * Implements Carson's "gate preflight before expensive CI" pattern.
 */

/* eslint-disable security/detect-object-injection */
/* eslint-disable security/detect-non-literal-fs-filename */
/* eslint-disable security/detect-non-literal-regexp */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Load harness configuration
const CONFIG_PATH = path.join(__dirname, '..', 'harness-config.json')

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('❌ harness-config.json not found')
    process.exit(1)
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (error) {
    console.error('❌ Invalid harness-config.json:', error.message)
    process.exit(1)
  }
}

function getChangedFiles() {
  try {
    // Try to get PR changed files first (for GitHub Actions)
    if (process.env.GITHUB_BASE_REF && process.env.GITHUB_HEAD_REF) {
      const baseRef = `origin/${process.env.GITHUB_BASE_REF}`
      return execSync(`git diff --name-only ${baseRef}...HEAD`, {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter(file => file.length > 0)
    }

    // Fallback: staged + unstaged changes (for local development)
    const staged = execSync('git diff --cached --name-only', {
      encoding: 'utf8',
    }).trim()
    const unstaged = execSync('git diff --name-only', {
      encoding: 'utf8',
    }).trim()

    return [
      ...new Set([
        ...staged.split('\n').filter(f => f.length > 0),
        ...unstaged.split('\n').filter(f => f.length > 0),
      ]),
    ]
  } catch (error) {
    console.error('❌ Failed to get changed files:', error.message)
    process.exit(1)
  }
}

function matchesPattern(filepath, patterns) {
  return patterns.some(pattern => {
    // Convert glob to regex: split on ** first, escape special chars within segments,
    // then join with .* for ** and [^/]* for *
    const regexPattern = pattern
      .split('**')
      .map(part =>
        part
          .split('*')
          .map(seg => seg.replace(/[\\^$+?.()|[\]{}]/g, '\\$&'))
          .join('[^/]*')
      )
      .join('.*')

    try {
      return new RegExp('^' + regexPattern + '$').test(filepath)
    } catch {
      console.warn(`Invalid pattern: ${pattern}`)
      return false
    }
  })
}

function calculateRiskTier(filepath, config) {
  const { riskTierRules } = config

  if (!riskTierRules || typeof riskTierRules !== 'object') {
    return 'low'
  }

  // Check in order of decreasing risk - use allowlist of known tiers
  const validTiers = ['critical', 'high', 'medium', 'low']
  for (const tier of validTiers) {
    if (riskTierRules[tier] && Array.isArray(riskTierRules[tier])) {
      if (matchesPattern(filepath, riskTierRules[tier])) {
        return tier
      }
    }
  }

  return 'low' // default
}

function validateRequiredChecks(riskTier, config) {
  if (!config.mergePolicy) {
    return {
      valid: false,
      error: `No merge policy defined for risk tier: ${riskTier}`,
    }
  }
  const policy = config.mergePolicy[riskTier]
  if (!policy) {
    return {
      valid: false,
      error: `No merge policy defined for risk tier: ${riskTier}`,
    }
  }

  const { requiredChecks } = policy
  const missingChecks = []

  for (const check of requiredChecks) {
    if (!config.checkDefinitions[check]) {
      missingChecks.push(check)
    }
  }

  if (missingChecks.length > 0) {
    return {
      valid: false,
      error: `Missing check definitions: ${missingChecks.join(', ')}`,
    }
  }

  return { valid: true }
}

function main() {
  console.log('🔍 Risk Policy Gate - Validating PR changes...\n')

  const config = loadConfig()
  const changedFiles = getChangedFiles()

  if (changedFiles.length === 0) {
    console.log('✅ No changed files detected - policy gate passed')
    return
  }

  console.log(`📁 Changed files (${changedFiles.length}):`)
  changedFiles.forEach(file => console.log(`   ${file}`))
  console.log('')

  // Calculate risk analysis - use plain object instead of Map
  const riskAnalysis = {}
  let highestRisk = 'low'
  const riskOrder = ['low', 'medium', 'high', 'critical']

  for (const file of changedFiles) {
    const risk = calculateRiskTier(file, config)
    if (!riskAnalysis[risk]) {
      riskAnalysis[risk] = []
    }
    riskAnalysis[risk].push(file)

    const currentRiskIndex = riskOrder.indexOf(risk)
    const highestRiskIndex = riskOrder.indexOf(highestRisk)
    if (currentRiskIndex > highestRiskIndex) {
      highestRisk = risk
    }
  }

  // Display risk analysis
  console.log('📊 Risk Analysis:')
  const validTiers = ['critical', 'high', 'medium', 'low']
  for (const tier of validTiers) {
    if (riskAnalysis[tier] && riskAnalysis[tier].length > 0) {
      const files = riskAnalysis[tier]
      const emoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[
        tier
      ]
      console.log(`   ${emoji} ${tier.toUpperCase()}: ${files.length} files`)
      if (files.length <= 3) {
        files.forEach(f => console.log(`      - ${f}`))
      } else {
        files.slice(0, 2).forEach(f => console.log(`      - ${f}`))
        console.log(`      ... and ${files.length - 2} more`)
      }
    }
  }
  console.log('')

  // Validate merge policy for highest risk tier
  console.log(`🎯 Merge Policy: ${highestRisk.toUpperCase()} tier requirements`)

  const validation = validateRequiredChecks(highestRisk, config)
  if (!validation.valid) {
    console.error(`❌ Policy validation failed: ${validation.error}`)
    process.exit(1)
  }

  const policy = config.mergePolicy[highestRisk]
  const { requiredChecks, reviewRequirement, evidenceRequirement } = policy

  console.log('   Required checks:')
  requiredChecks.forEach(check => {
    const def = config.checkDefinitions[check]
    console.log(`      ✓ ${check} (${def.description})`)
  })

  console.log(`   Review requirement: ${reviewRequirement}`)
  console.log(`   Evidence requirement: ${evidenceRequirement}`)
  console.log('')

  // Check for docs drift if enabled
  if (config.docsDriftRules?.enabled) {
    const affectedWatchPaths = changedFiles.filter(file =>
      config.docsDriftRules.watchPaths.some(pattern =>
        matchesPattern(file, [pattern])
      )
    )

    if (affectedWatchPaths.length > 0) {
      console.log('📝 Docs drift check:')
      console.log('   Changed files that may require doc updates:')
      affectedWatchPaths.forEach(file => console.log(`      - ${file}`))
      console.log('   Required updates:')
      config.docsDriftRules.requiredUpdates.forEach(path =>
        console.log(`      - ${path}`)
      )
      console.log('')
    }
  }

  // Output machine-readable summary for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    const summary = {
      highestRisk,
      requiredChecks: requiredChecks.join(','),
      reviewRequired: reviewRequirement !== 'none',
      changedFileCount: changedFiles.length,
    }

    const outputPath = process.env.GITHUB_OUTPUT
    // Validate output path is safe before using
    if (outputPath && typeof outputPath === 'string' && outputPath.length > 0) {
      try {
        Object.entries(summary).forEach(([key, value]) => {
          const line = `${key}=${value}\n`
          fs.appendFileSync(outputPath, line, { encoding: 'utf8' })
        })
      } catch (error) {
        console.warn('Failed to write GitHub Actions output:', error.message)
      }
    }
  }

  console.log('✅ Risk policy gate passed')
  console.log(
    `📈 Proceeding with ${highestRisk.toUpperCase()} tier requirements`
  )
}

if (require.main === module) {
  main()
}

module.exports = { calculateRiskTier, validateRequiredChecks }

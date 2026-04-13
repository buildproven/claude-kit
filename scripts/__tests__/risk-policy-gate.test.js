const {
  calculateRiskTier,
  validateRequiredChecks,
} = require('../risk-policy-gate')

// Minimal config mirroring real harness-config.json shape
const config = {
  riskTierRules: {
    critical: [
      'scripts/**',
      'config/**',
      '.github/workflows/**',
      'install.sh',
      'package.json',
    ],
    high: [
      'commands/bs/quality.md',
      'commands/bs/dev.md',
      'commands/bs/ralph.md',
    ],
    medium: ['commands/bs/**', 'skills/**', 'agents/**'],
    low: ['docs/**', '*.md', 'README.md'],
  },
  mergePolicy: {
    critical: { requiredChecks: ['lint', 'security', 'smoke-test'] },
    high: { requiredChecks: ['lint', 'smoke-test'] },
    medium: { requiredChecks: ['lint'] },
    low: { requiredChecks: ['lint'] },
  },
  checkDefinitions: {
    lint: { description: 'Linting' },
    security: { description: 'Security scan' },
    'smoke-test': { description: 'Smoke test' },
  },
}

// ─── calculateRiskTier ────────────────────────────────────────────────────────

describe('calculateRiskTier', () => {
  describe('critical tier', () => {
    it('matches scripts/ glob', () => {
      expect(calculateRiskTier('scripts/helper.js', config)).toBe('critical')
    })

    it('matches config/ glob', () => {
      expect(calculateRiskTier('config/settings.json', config)).toBe('critical')
    })

    it('matches .github/workflows/ glob', () => {
      expect(calculateRiskTier('.github/workflows/ci.yml', config)).toBe(
        'critical'
      )
    })

    it('matches exact filename (install.sh)', () => {
      expect(calculateRiskTier('install.sh', config)).toBe('critical')
    })

    it('matches exact filename (package.json)', () => {
      expect(calculateRiskTier('package.json', config)).toBe('critical')
    })

    it('matches deeply nested scripts/ file', () => {
      expect(calculateRiskTier('scripts/subdir/helper.js', config)).toBe(
        'critical'
      )
    })
  })

  describe('high tier', () => {
    it('matches exact high-priority command file', () => {
      expect(calculateRiskTier('commands/bs/quality.md', config)).toBe('high')
    })

    it('matches another exact high-priority file', () => {
      expect(calculateRiskTier('commands/bs/ralph.md', config)).toBe('high')
    })

    it('prefers high over medium for explicitly listed files', () => {
      // commands/bs/dev.md is in high AND would match commands/bs/** (medium)
      expect(calculateRiskTier('commands/bs/dev.md', config)).toBe('high')
    })
  })

  describe('medium tier', () => {
    it('matches commands/bs/ glob for non-high file', () => {
      expect(calculateRiskTier('commands/bs/workflow.md', config)).toBe(
        'medium'
      )
    })

    it('matches skills/ glob', () => {
      expect(calculateRiskTier('skills/test-strategy/index.md', config)).toBe(
        'medium'
      )
    })

    it('matches agents/ glob', () => {
      expect(calculateRiskTier('agents/code-reviewer.md', config)).toBe(
        'medium'
      )
    })
  })

  describe('low tier', () => {
    it('matches docs/ glob', () => {
      expect(calculateRiskTier('docs/workflow.md', config)).toBe('low')
    })

    it('matches root *.md glob', () => {
      expect(calculateRiskTier('CHANGELOG.md', config)).toBe('low')
    })

    it('matches README.md exactly', () => {
      expect(calculateRiskTier('README.md', config)).toBe('low')
    })
  })

  describe('fallback behavior', () => {
    it('defaults to low for unmatched files', () => {
      expect(calculateRiskTier('unknown/mystery-file.txt', config)).toBe('low')
    })

    it('defaults to low for root-level unknown file', () => {
      expect(calculateRiskTier('some-random-file.js', config)).toBe('low')
    })

    it('defaults to low when riskTierRules is empty', () => {
      const emptyConfig = { ...config, riskTierRules: {} }
      expect(calculateRiskTier('scripts/foo.sh', emptyConfig)).toBe('low')
    })
  })

  describe('pattern matching edge cases', () => {
    it('does not match parent dir as scripts/ file', () => {
      // "scripts-backup/foo.sh" should NOT match "scripts/**"
      expect(calculateRiskTier('scripts-backup/foo.sh', config)).toBe('low')
    })

    it('does not confuse partial path segment', () => {
      // "notscripts/foo.sh" should NOT match "scripts/**"
      expect(calculateRiskTier('notscripts/foo.sh', config)).toBe('low')
    })
  })
})

// ─── validateRequiredChecks ───────────────────────────────────────────────────

describe('validateRequiredChecks', () => {
  it('returns valid for critical tier with all checks defined', () => {
    expect(validateRequiredChecks('critical', config)).toEqual({ valid: true })
  })

  it('returns valid for low tier', () => {
    expect(validateRequiredChecks('low', config)).toEqual({ valid: true })
  })

  it('returns invalid for tier not in mergePolicy', () => {
    const result = validateRequiredChecks('nonexistent', config)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/No merge policy/i)
  })

  it('returns invalid when a requiredCheck is missing from checkDefinitions', () => {
    const cfg = {
      ...config,
      mergePolicy: {
        critical: { requiredChecks: ['lint', 'missing-check'] },
      },
    }
    const result = validateRequiredChecks('critical', cfg)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/missing-check/)
  })

  it('returns valid when requiredChecks is empty', () => {
    const cfg = {
      ...config,
      mergePolicy: { critical: { requiredChecks: [] } },
    }
    expect(validateRequiredChecks('critical', cfg)).toEqual({ valid: true })
  })

  it('returns invalid for missing mergePolicy key entirely', () => {
    const cfg = { ...config, mergePolicy: undefined }
    const result = validateRequiredChecks('critical', cfg)
    expect(result.valid).toBe(false)
  })
})

const fc = require('fast-check')
const { matchesPattern } = require('../risk-policy-gate')

// Helper: generate strings from a specific character set
function stringFromChars(chars, minLength = 1, maxLength = 40) {
  return fc
    .array(fc.constantFrom(...chars.split('')), {
      minLength,
      maxLength,
    })
    .map(arr => arr.join(''))
}

const FILEPATH_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-_./'
const ALPHA_CHARS = 'abcdefghijklmnopqrstuvwxyz'
const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyz/.-_'

describe('matchesPattern — property-based', () => {
  it('** matches any filepath', () => {
    fc.assert(
      fc.property(stringFromChars(FILEPATH_CHARS, 1, 80), filepath => {
        return matchesPattern(filepath, ['**'])
      }),
      { numRuns: 200 }
    )
  })

  it('exact pattern matches only itself', () => {
    fc.assert(
      fc.property(
        stringFromChars(ALPHA_CHARS, 1, 30),
        stringFromChars(ALPHA_CHARS, 1, 30),
        (pattern, other) => {
          expect(matchesPattern(pattern, [pattern])).toBe(true)
          if (pattern !== other) {
            expect(matchesPattern(other, [pattern])).toBe(false)
          }
          return true
        }
      ),
      { numRuns: 200 }
    )
  })

  it('scripts/** never matches non-scripts/ paths', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'src',
          'lib',
          'docs',
          'config',
          'commands',
          'tests',
          'other'
        ),
        stringFromChars('abcdefghijklmnopqrstuvwxyz0123456789-_.', 1, 30),
        (dir, file) => {
          const filepath = `${dir}/${file}.js`
          expect(matchesPattern(filepath, ['scripts/**'])).toBe(false)
          return true
        }
      ),
      { numRuns: 200 }
    )
  })

  it('pattern with no wildcards is exact match', () => {
    fc.assert(
      fc.property(stringFromChars(SAFE_CHARS, 2, 40), pattern => {
        if (pattern.includes('*') || pattern.includes('?')) return true
        expect(matchesPattern(pattern, [pattern])).toBe(true)
        expect(matchesPattern(pattern + 'x', [pattern])).toBe(false)
        return true
      }),
      { numRuns: 200 }
    )
  })

  it('invalid regex in pattern returns false (no throw)', () => {
    const badPatterns = ['[invalid', '(unclosed', '{bad}']
    for (const p of badPatterns) {
      expect(() => matchesPattern('test.js', [p])).not.toThrow()
    }
  })
})

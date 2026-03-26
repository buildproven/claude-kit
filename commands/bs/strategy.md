---
model: opus
name: bs:strategy
description: 'Multi-model strategy synthesis & advisory panel (Claude + GPT + Gemini + Perplexity)'
argument-hint: "/bs:strategy 'What pricing model for B2B SaaS?' [--mode debate|parallel] [--providers claude,openai,gemini,perplexity]"
category: strategy
---

model: opus

# /bs:strategy - Multi-Model Strategy Synthesis & Advisory Panel

**Usage**: `/bs:strategy "<question>" [--context <file>] [--providers <list>] [--mode debate|parallel]`

Use for: architecture decisions, business/pricing strategy, debugging when stuck, validating assumptions before major refactors.

## Phase 1: Question Analysis

Ultrathink. Use sequential thinking to:

1. Identify the core question and sub-questions
2. Assess what context is essential
3. Determine perspectives needed (technical, business, user, market)
4. Optimize framing per provider

Output: refined question(s) + critical context + specific angles per provider.

## Phase 2: Query Multiple LLMs in Parallel

Parse flags:

```
providers = from --providers flag or ["claude", "openai", "gemini", "perplexity"]
mode = from --mode flag or "parallel"
context = read file from --context flag if provided
If mode is "debate", skip to Debate Mode below.
```

**Claude (if in providers):** Answer refined question from implementation-focused perspective.

**GPT (if in providers and OPENAI_API_KEY available):**

```javascript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content:
          'You are a strategic advisor. Provide actionable business insights.',
      },
      {
        role: 'user',
        content: refinedQuestion + (context ? `\n\nContext:\n${context}` : ''),
      },
    ],
  }),
})
```

**Gemini (if in providers):**

```bash
acpx gemini exec "You are a strategic advisor providing independent analysis.

Question: ${refinedQuestion}
${context ? 'Context: ' + context : ''}

Provide: Strategic analysis, technical feasibility, potential pitfalls/risks, confidence level (1-10).
Be concise. Focus on what other models might miss."
```

**Codex (if in providers):**

```bash
acpx codex exec "Strategic analysis needed:

Question: ${refinedQuestion}
${context ? 'Context: ' + context : ''}

Provide: Technically optimal approach, engineering tradeoffs, overlooked implementation risks, confidence level (1-10).
Be specific. Disagree with conventional wisdom if warranted."
```

**Perplexity (if in providers and PERPLEXITY_API_KEY available):**

```javascript
const response = await fetch('https://api.perplexity.ai/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'llama-3.1-sonar-large-128k-online',
    messages: [
      {
        role: 'system',
        content: 'Be precise and cite your sources with markdown links.',
      },
      {
        role: 'user',
        content: refinedQuestion + (context ? `\n\nContext:\n${context}` : ''),
      },
    ],
  }),
})
```

Collect all responses before Phase 3.

## Phase 3: Response Synthesis

Use sequential thinking to analyze collected responses:

1. **Agreement Analysis** — where do ALL models agree? (HIGH confidence)
2. **Disagreement Analysis** — where do they contradict and why?
3. **Unique Insights** — what does each provider add?
4. **Gap Analysis** — what's missing or unaddressed?
5. **Synthesis** — unified best-in-class answer with confidence level

## Output Format

1. **Synthesized Answer** — unified recommendation
2. **Confidence Level** — HIGH/MODERATE/LOW with reasoning
3. **Key Agreements** — where all models aligned
4. **Notable Differences** — divergences and why they matter
5. **Unique Insights** — best points from each provider
6. **Gaps & Follow-ups** — what needs further exploration
7. **Sources** — from Perplexity web search

## Debate Mode (--mode debate)

Run models sequentially so they respond to each other:

1. **Claude** — initial analysis
2. **Gemini** — responds to Claude:

   ```bash
   acpx gemini exec "Claude analyzed this problem and said: [Claude's response].
   Do you agree? What would you add or challenge?"
   ```

3. **ChatGPT** — responds to both:

   ```bash
   ~/.pyenv/shims/openai api chat.completions.create \
     -m gpt-4o \
     -g system "You are the final voice on an advisory panel." \
     -g user "Problem: [PROBLEM]
   Claude said: [response]
   Gemini said: [response]
   Your thoughts? Where do you agree, disagree, or see something both missed?"
   ```

4. **Claude** — final synthesis

**Debate output format:**

```
## Advisory Panel Debate: [Problem Summary]

### Consensus (High Confidence)
### Divergent Views
### Unique Insights
### Recommended Approach
### Next Steps
```

## Error Handling

If a model fails (auth, timeout, missing CLI): note which succeeded/failed, proceed with available responses, be transparent in synthesis.

## API Keys & CLIs

- `ANTHROPIC_API_KEY` — Claude
- `OPENAI_API_KEY` — GPT-4 (optional)
- `PERPLEXITY_API_KEY` — Perplexity with web sources (optional)
- Gemini CLI: `~/.nvm/versions/node/v22.17.0/bin/gemini` (optional)
- OpenAI CLI: `~/.pyenv/shims/openai` (optional, debate mode)

Without external APIs: runs using only Claude. With 1+ external APIs: multi-perspective synthesis.

## Examples

```bash
/bs:strategy "What's the best pricing strategy for a B2B SaaS?"
/bs:strategy "Should we add a free tier?" --context ./docs/strategy/VIBEBUILDLAB.md
/bs:strategy "React vs Vue for dashboard app" --providers claude,openai
/bs:strategy "Should we use microservices or monolith?" --mode debate
/bs:strategy "Best approach for real-time notifications at scale" --mode debate --providers claude,gemini,openai
```

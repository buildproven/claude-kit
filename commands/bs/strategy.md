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

Covers both strategy synthesis (querying multiple LLMs in parallel) and advisory panel use cases (debate mode where models respond to each other sequentially).

### When to Use

- Architecture decisions with multiple valid approaches
- Business strategy and pricing questions
- Debugging when stuck after multiple attempts
- Validating assumptions before major refactors
- Getting outside perspective on technical approach

## Enhanced Workflow with Sequential Thinking

### Phase 1: Question Analysis (Before Querying LLMs)

**Use Sequential Thinking to analyze and refine the question:**

```markdown
Use sequential thinking to analyze this strategy question:

**Question:** [user's question]
**Context:** [any provided context]

**Analyze step by step:**

1. **Core Question Identification**
   - What's the fundamental question being asked?
   - Are there multiple sub-questions embedded?
   - What's the real decision to be made?

2. **Critical Context Assessment**
   - What context is essential for good answers?
   - What assumptions are embedded in the question?
   - What background might LLMs need?

3. **Perspective Analysis**
   - What perspectives are needed? (technical, business, user, market)
   - What expertise areas are relevant?
   - What might be blindspots in the question?

4. **Framing Optimization**
   - How should we frame this for each LLM?
   - Should we ask differently for Claude vs GPT vs Perplexity?
   - What follow-up constraints should be added?

**Output:**

- Refined question(s) to send to LLMs
- Critical context to include
- Specific angles to request from each provider
```

### Phase 2: Query Multiple LLMs in Parallel

After refining the question, query Claude, GPT, and Perplexity directly:

**Parse providers flag:**

```
providers = extract from --providers flag or ["claude", "openai", "gemini", "perplexity"]
mode = extract from --mode flag or "parallel"

If mode is "debate", skip to the "Debate Mode" section below.
context = read file from --context flag if provided
```

**Make parallel API calls:**

**Claude (if in providers):**

```
Use current Claude conversation to answer the refined question
Request: Provide strategic analysis from an implementation-focused perspective
```

**GPT (if in providers and OPENAI_API_KEY available):**

```javascript
// Use WebFetch or Node.js if needed
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
# Using Gemini CLI (installed at ~/.nvm/versions/node/v22.17.0/bin/gemini)
~/.nvm/versions/node/v22.17.0/bin/gemini "You are a strategic advisor providing independent analysis.

Question: ${refinedQuestion}
${context ? 'Context: ' + context : ''}

Provide:
1. Strategic analysis from your perspective
2. Technical feasibility assessment if applicable
3. Potential pitfalls and risks
4. Confidence level (1-10) with justification

Be concise and specific. Focus on what other models might miss."
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

**Collect all responses before proceeding to Phase 3.**

### Phase 3: Response Synthesis (After Collecting LLM Responses)

**Use Sequential Thinking to synthesize responses intelligently:**

```markdown
Use sequential thinking to synthesize these responses:

**Claude's Response:** [summary]
**GPT's Response:** [summary]
**Gemini's Response:** [summary]
**Perplexity's Response:** [summary with sources]

**Analyze step by step:**

1. **Agreement Analysis**
   - Where do ALL models strongly agree? (HIGH confidence areas)
   - What common themes emerge across responses?
   - What's the consensus recommendation?

2. **Disagreement Analysis**
   - Where do models disagree or contradict?
   - Why might they disagree? (different training, approaches, etc.)
   - Which perspective is more relevant for this use case?

3. **Unique Insights**
   - What unique value does Claude provide?
   - What unique value does GPT provide?
   - What unique value does Gemini provide?
   - What unique value does Perplexity provide? (sources, recency)

4. **Gap Analysis**
   - What's missing from all responses?
   - What wasn't addressed from the original question?
   - What follow-up questions emerge?

5. **Synthesis**
   - What's the unified, best-in-class answer?
   - How confident should we be? (based on agreement)
   - What caveats or considerations exist?

**Output:**

- Synthesized recommendation
- Confidence level with rationale
- Notable divergences and why they matter
- Gaps or follow-up questions
```

## After Synthesis Completes

Present the analysis to the user:

1. **Synthesized Answer** - The best unified recommendation
2. **Confidence Level** - HIGH/MODERATE/LOW with reasoning
3. **Key Agreements** - Where all models aligned
4. **Notable Differences** - Where models diverged and why it matters
5. **Unique Insights** - Best points from each provider
6. **Gaps & Follow-ups** - What's missing or needs further exploration
7. **Sources** - From Perplexity web search

## Examples

```bash
# Business strategy question (parallel mode, default)
/bs:strategy "What's the best pricing strategy for a B2B SaaS?"

# With context
/bs:strategy "Should we add a free tier?" --context ./docs/strategy/VIBEBUILDLAB.md

# Specific providers only
/bs:strategy "React vs Vue for dashboard app" --providers claude,openai

# Debate mode - models respond to each other sequentially
/bs:strategy "Should we use microservices or monolith?" --mode debate

# Advisory panel for architecture decisions
/bs:strategy "Best approach for real-time notifications at scale" --mode debate --providers claude,gemini,openai
```

## Debate Mode (--mode debate)

When `--mode debate` is specified, run models sequentially so they respond to each other:

1. **Claude's Initial Analysis** - Get Claude's perspective on the question first
2. **Gemini Responds** - Share Claude's analysis with Gemini:

   ```bash
   ~/.nvm/versions/node/v22.17.0/bin/gemini "Claude analyzed this problem and said: [Claude's response].

   Do you agree? What would you add or challenge? Provide your own analysis."
   ```

3. **ChatGPT Responds** - Share both with ChatGPT:

   ```bash
   ~/.pyenv/shims/openai api chat.completions.create \
     -m gpt-4o \
     -g system "You are the final voice on an advisory panel. Two other AI models have already weighed in." \
     -g user "Problem: [PROBLEM]

   Claude said: [Claude's response]
   Gemini said: [Gemini's response]

   Your thoughts? Where do you agree, disagree, or see something both missed?"
   ```

4. **Final Synthesis** - Claude synthesizes all perspectives into a unified recommendation

Present debate results in this format:

```
## Advisory Panel Debate: [Problem Summary]

### Consensus (High Confidence)
- [Points all models agreed on]

### Divergent Views
- Claude: [view] | Gemini: [view] | ChatGPT: [view]
- Assessment: [which view seems most appropriate and why]

### Unique Insights
- [Model]: [insight no other model raised]

### Recommended Approach
[Synthesized recommendation with reasoning]

### Next Steps
1. [Action item]
2. [Action item]
```

## Error Handling

If a model fails (auth issues, timeout, missing CLI):

- Note which models succeeded/failed
- Proceed with available responses
- Be transparent about limitations in synthesis

## API Keys & CLIs

Set these in environment for multi-provider synthesis:

- `ANTHROPIC_API_KEY` - Claude (usually already set for Claude Code)
- `OPENAI_API_KEY` - GPT-4 (optional, skips if not set)
- `PERPLEXITY_API_KEY` - Perplexity with web sources (optional, skips if not set)
- **Gemini CLI** - `~/.nvm/versions/node/v22.17.0/bin/gemini` (optional, skips if not available)
- **OpenAI CLI** - `~/.pyenv/shims/openai` (optional, used for debate mode ChatGPT)

**Without external APIs:** Command still works using only Claude in current conversation.
**With 1+ external APIs:** Gets multiple perspectives for higher-confidence synthesis.

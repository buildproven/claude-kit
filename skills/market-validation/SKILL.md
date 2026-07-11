---
name: market-validation
auto_invoke: true
description: Market validation, competitor mapping, pricing benchmarks, niche analysis, and revenue-plan building for products, newsletters, SaaS, and AI offers. Use when the user wants a more rigorous go-to-market view than brainstorming, including demand signals, adjacent competitors, conversion assumptions, pricing comparisons, risks, and a realistic path to revenue.
---

# Market Validation

Use this skill when the user wants a research-backed answer to questions like:

- is this niche any good?
- who else is serving this market?
- what are competitors charging?
- can this become a real business?
- what would it take to reach a revenue target?
- build me a more bulletproof plan

This skill is for **validation**, not generic ideation. The goal is to replace vague optimism with evidence, explicit assumptions, and clear next steps.

## Rules

1. **Browse current sources.** Do not rely on memory for market, pricing, or competitor claims.
2. **Separate evidence from inference.** Label what is observed vs what is estimated.
3. **Use the user's actual starting point.** Read local docs, analytics, product pages, or repo data before projecting revenue.
4. **Prefer adjacent real buyers and real offers** over abstract TAM slides.
5. **Do not present revenue scenarios as facts.** Show the math and the assumptions.

## Minimum Research Pass

For a serious validation request, cover these five areas:

### 1. Buyer and pain

Determine:

- who the buyer is
- what job they are hiring the product for
- what pain is expensive enough to pay for
- what words they already use

Use:

- the user's repo/docs/site
- competitor positioning
- public market signals

Call `perplexity_ask`:

```
"What language do [buyer type] use when describing [pain area]? What communities, forums, or platforms are they active on? What are they currently paying for to solve this problem?"
```

Tailor the query to the actual buyer and niche — do not use generic phrasing.

### 2. Competitor map

Build a simple landscape:

- direct competitors
- adjacent competitors
- substitutes
- "DIY with AI" alternatives

For each competitor, capture when possible:

- target buyer
- promise
- pricing
- proof style
- weakness or gap

Call `perplexity_research` with `reasoning_effort: "medium"` (one call — it's the expensive `sonar-deep-research` model; fan out cheap `perplexity_ask`/`perplexity_search` calls for specifics):

```
"Who are the direct and adjacent competitors in [niche/category]? Include newsletters, courses, communities, SaaS tools, and indie products. For each, note their target buyer, core promise, pricing if visible, and any apparent weakness or gap."
```

Also call `perplexity_ask` for any specific competitor domain you know about:

```
"What has [competitor] launched or changed recently? Any new pricing, positioning, or product moves?"
```

### 3. Pricing benchmark

Find current pricing anchors across:

- low-ticket info products
- core digital products
- cohorts / guided programs
- premium advisory / implementation
- SaaS or B2B tools if relevant

Call `perplexity_ask`:

```
"What are current pricing benchmarks for [product type] in [niche]? Include low-ticket info products, cohorts, premium advisory, and SaaS tools. What are buyers actually paying in 2026?"
```

Do not invent pricing benchmarks. If pricing is unavailable, say that and use the nearest defensible anchor.

### 4. Funnel and traction reality

Use actual available signals:

- email list size
- open rate
- CTR
- traffic
- conversion data
- existing product sales
- audience fit

Then estimate:

- likely conversion ranges
- required buyer counts
- where the model breaks

### 5. Revenue path

Build a realistic path with:

- best bet
- stretch path
- likely blockers
- milestones by quarter or phase

## Output Format

When the user asks for a validated plan, aim to produce:

1. **Verdict Up Front**
2. **What the market evidence says**
3. **Competitor and pricing view**
4. **What is strong / weak / missing**
5. **Revenue model with assumptions**
6. **Best path vs weaker paths**
7. **Next steps**

## Useful Deliverables

Depending on the ask, produce one or more of:

- niche assessment
- positioning memo
- competitor map
- pricing benchmark
- revenue plan
- assumptions and risks memo
- validation checklist

## Good Validation Questions

Ask yourself:

- is this problem expensive, frequent, and painful?
- who already gets paid to solve it?
- what is the nearest thing buyers are already buying?
- what proof would a skeptical buyer require?
- what has to be true for the revenue target to work?
- what is likely to fail first?

## Anti-Patterns

Avoid:

- vague TAM-heavy writeups
- inflated revenue optimism without conversion math
- "nobody is doing this" claims after shallow research
- treating content reach as revenue proof
- mixing multiple buyer types into one forecast without saying so

## Notes For AI / Agent Products

When the product involves AI, agents, or workflows:

- distinguish between automation, copilots, and truly agentic systems
- identify where human review remains
- check if buyers are paying for outcomes or just curiosity
- treat trust, validation, and failure handling as part of the offer

## If Local Data Exists

Prefer reading:

- analytics files
- product registries
- pricing pages
- email performance
- roadmap and strategy docs

Use those to ground the forecast before expanding outward.

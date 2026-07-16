---
name: frontend-design
auto_invoke: true
context: fork
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

> Derived from Anthropic's Apache-2.0 `frontend-design` skill and substantially
> modified by buildproven. Changes include expanded production guidance, the
> AI-ism denylist, mandatory self-review, and original design-reference datasets.
> See `LICENSE.txt` and the repository `NOTICE` for provenance and license scope.

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:

- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:

- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

### The AI-ism denylist

These are the specific defaults that most AI tools converge on — they instantly read as "generated, not designed." Treat every one as off-limits unless the user explicitly asks for it, the brand genuinely calls for it, or you can give a one-line reason it's the right call. When you reach for one out of habit, stop and make a deliberate choice instead.

1. **Bento grids** — the asymmetric grid of rounded boxes used as a catch-all layout.
2. **Gradient text headlines** — multi-color fades on big type, especially purple-to-pink or purple-to-blue.
3. **"AI purple"** — violet/indigo (`#6366F1`, `#7C3AED`, `#8B5CF6`) as the default brand color, plus the purple-to-blue hero gradient that travels with it.
4. **Decorative pills and badges** — the floating "New" / "AI-powered" tag above every hero headline. Keep only if it carries real information.
5. **Cards for the sake of cards** — wrapping every block in a bordered, shadowed, rounded rectangle. Strip containers that aren't earning their place.
6. **Frosted glass / glassmorphism** — translucent backdrop-blur panels layered over a gradient.
7. **Dark hero with glowing blobs** — near-black background with soft blurred colored orbs behind the headline.
8. **The three-column feature strip** — three identical columns of generic-icon + bold-title + gray one-liner.
9. **Center-everything layouts** — every section centered in a narrow max-width column with identical oversized vertical padding.
10. **Generic icon spam** — emoji or thin line-icons dropped in as feature icons with no real meaning.
11. **One-font-fits-all** — Inter or Geist everywhere at default weights with no typographic point of view.
12. **Over-rounded, over-shadowed everything** — huge border-radius and soft drop shadows applied uniformly to every element.
13. **Faux-glow buttons** — gradient-filled buttons with an outer glow and no clear hierarchy.

Also avoid: stock-style abstract 3D blobs or floating UI screenshots as the only hero visual; a "Trusted by" logo bar dropped in as the default second section; identical spacing and rhythm in every section; symmetry as a default — real layouts use intentional tension and emphasis.

### Mandatory self-review before delivering

Before showing the user anything, scan your own output against the denylist. For each item you find, replace it with an intentional alternative — then close with a short note listing which AI-isms you steered away from and what you did instead. Quick gate:

- Primary color violet/indigo, or a purple-to-blue gradient? → palette tied to the brand or content instead.
- Gradient text on any headline? → make it solid; let type and scale carry the impact.
- Layout a bento grid or a centered stack of cards? → rework into something more varied and intentional.
- Decorative pill above the hero? → remove unless it carries real information.
- Frosted-glass panels or glowing background blobs? → remove or replace with something purposeful.
- Every block wrapped in a rounded, shadowed card? → strip the containers that aren't earning their place.
- Feature section as three identical icon-title-text columns? → break the pattern.
- Type relying on a single default font at default weights? → introduce a real type system.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.

## Design Reference Data

When you know the product type or industry, consult these CSV data files for informed design decisions. Read them on demand — don't load all at once.

| File                     | What it contains                                                                                                                 | When to use                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `data/products.csv`      | 161 product types → recommended styles, landing patterns, dashboard styles, color focus                                          | First lookup — identifies the right style + palette for the product   |
| `data/colors.csv`        | 161 WCAG-validated color palettes with full semantic tokens (primary, secondary, accent, muted, border, destructive + on-colors) | When setting up CSS variables or Tailwind theme                       |
| `data/typography.csv`    | 57 font pairings with Google Fonts URLs, CSS imports, and Tailwind config                                                        | When choosing fonts — use as starting points, then customize          |
| `data/styles.csv`        | 73 design styles with detailed specs (colors, effects, use cases)                                                                | When exploring aesthetic directions beyond the basics                 |
| `data/ux-guidelines.csv` | 99 UX rules with severity, do/don't, and code examples                                                                           | Pre-delivery checklist — verify touch targets, a11y, animation timing |
| `data/charts.csv`        | 25 chart type recommendations                                                                                                    | When the UI includes data visualization                               |

**How to use**: Read `data/products.csv` first to match the product type. Then pull the corresponding palette from `data/colors.csv` and font pairing from `data/typography.csv`. Use these as a foundation — then apply your creative direction on top. The data gives you "correct"; your aesthetic vision makes it "memorable".

**IMPORTANT**: These are starting points, not constraints. Always customize and push beyond the defaults. A fintech dashboard that uses the recommended navy+gold palette but adds an unexpected animation language or spatial composition is better than one that follows the data files verbatim.

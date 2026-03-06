---
name: ui-reviewer
description: Expert UI/UX design reviewer for SaaS applications. Analyzes screenshots or live apps to evaluate visual hierarchy, spacing, typography, color usage, accessibility, and modern design patterns. Use when user wants to review, critique, audit, or get feedback on their UI design, or when asking "is this design good?" or "how can I improve this UI?" Provides actionable redesign recommendations with specific improvements.
---

# UI Reviewer

Analyze SaaS application interfaces and provide actionable design feedback.

## Review Process

1. **Capture the UI** - Screenshot or navigate to the app
2. **Analyze against criteria** - Score each dimension
3. **Identify top issues** - Prioritize by impact
4. **Provide specific fixes** - Actionable recommendations

## Evaluation Criteria

### Visual Hierarchy (Weight: High)

- Clear focal points guiding user attention
- Proper heading hierarchy (H1 > H2 > H3)
- CTAs visually prominent
- Secondary actions appropriately subdued

### Spacing & Layout (Weight: High)

- Consistent padding/margins (8px grid system)
- Adequate whitespace - not cramped
- Logical content grouping
- Responsive considerations

### Typography (Weight: Medium)

- Max 2-3 font families
- Clear size hierarchy (16px+ body text)
- Adequate line-height (1.4-1.6)
- Readable contrast

### Color Usage (Weight: Medium)

- Cohesive palette (2-3 primary + neutrals)
- Meaningful color application (not decorative)
- Sufficient contrast (WCAG AA: 4.5:1 text, 3:1 UI)
- Consistent use of accent colors

### Component Quality (Weight: Medium)

- Modern, polished UI components
- Consistent styling across elements
- Appropriate use of shadows/borders
- Interactive states visible (hover, focus, active)

### UX Patterns (Weight: High)

- Intuitive navigation
- Clear feedback for actions
- Appropriate loading/empty states
- Error handling visible
- Mobile-friendly patterns

### SaaS-Specific (Weight: Medium)

- Clear value proposition above fold
- Pricing clarity (if applicable)
- Trust signals present
- Onboarding flow quality
- Dashboard information density

## Output Format

```
## UI Review: [App Name]

### Overall Score: X/10

### Strengths
- [What's working well]

### Critical Issues (Fix First)
1. **[Issue]**: [Description]
   → Fix: [Specific recommendation]

### Improvements (Nice to Have)
1. **[Issue]**: [Description]
   → Fix: [Specific recommendation]

### Quick Wins
- [Small changes with big impact]

### Redesign Recommendations
[If significant issues, provide specific redesign direction]
```

## Scoring Guide

| Score | Meaning                                |
| ----- | -------------------------------------- |
| 9-10  | Production-ready, polished             |
| 7-8   | Good, minor improvements needed        |
| 5-6   | Functional but dated or inconsistent   |
| 3-4   | Significant issues affecting usability |
| 1-2   | Major redesign required                |

## Common SaaS UI Issues

**Navigation**: Overcrowded nav, unclear IA, missing breadcrumbs
**Dashboards**: Too dense, no visual hierarchy, unclear metrics
**Forms**: Poor validation, unclear labels, too long
**Tables**: No sorting/filtering, poor mobile view, cramped
**Empty States**: Missing or unhelpful
**CTAs**: Weak contrast, unclear copy, competing buttons

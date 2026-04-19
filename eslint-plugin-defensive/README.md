# eslint-plugin-defensive

ESLint plugin for defensive coding patterns - catches issues that standard lint/type checks miss.

Based on patterns discovered during exit-number and retire-runway audits where 24 issues slipped through standard quality checks.

## Installation

```bash
npm install eslint-plugin-defensive --save-dev
# or
yarn add eslint-plugin-defensive --dev
# or
pnpm add eslint-plugin-defensive --save-dev
```

## Usage

### Flat Config (eslint.config.js) - ESLint 9+

```javascript
import defensive from "eslint-plugin-defensive";

export default [
  {
    plugins: {
      defensive,
    },
    rules: {
      "defensive/no-unsafe-json-parse": "error",
      "defensive/no-empty-catch": "error",
      "defensive/require-auth-middleware": "warn",
      "defensive/require-useCallback": "warn",
      "defensive/require-guard-clause": "warn",
    },
  },
];
```

### Legacy Config (.eslintrc.js) - ESLint 8

```javascript
module.exports = {
  plugins: ["defensive"],
  extends: ["plugin:defensive/recommended"],
};
```

Or configure rules individually:

```javascript
module.exports = {
  plugins: ["defensive"],
  rules: {
    "defensive/no-unsafe-json-parse": "error",
    "defensive/no-empty-catch": "error",
    "defensive/require-auth-middleware": [
      "warn",
      {
        authWrappers: ["withAuth", "requireAuth"],
        publicRoutes: ["**/api/health/**", "**/api/public/**"],
      },
    ],
    "defensive/require-useCallback": [
      "warn",
      {
        ignoredProps: ["render", "children"],
        maxInlineHandlers: 0,
      },
    ],
    "defensive/require-guard-clause": [
      "warn",
      {
        allowLiterals: true,
      },
    ],
  },
};
```

## Rules

### `no-unsafe-json-parse`

Requires `JSON.parse()` to be wrapped in try/catch or used with Zod validation.

**Bad:**

```javascript
const data = JSON.parse(rawData);
```

**Good:**

```javascript
// Option 1: try/catch
try {
  const data = JSON.parse(rawData);
} catch (e) {
  handleError(e);
}

// Option 2: Zod validation
const result = schema.safeParse(JSON.parse(rawData));
```

### `no-empty-catch`

Requires meaningful error handling in catch blocks. Console.log alone is not sufficient.

**Bad:**

```javascript
try {
  await saveData();
} catch (e) {
  console.log(e); // User never knows something failed
}
```

**Good:**

```javascript
try {
  await saveData();
} catch (e) {
  setError("Failed to save: " + e.message);
  // OR: throw e; // Re-throw for error boundary
}
```

**Options:**

- `allowedPatterns`: Array of function names that count as valid error handling. Default: `["setError", "toast", "notify", "showError", "handleError", "reportError", "captureException", "throw"]`

### `require-auth-middleware`

Flags API route handlers that aren't wrapped with auth middleware.

**Bad:**

```javascript
// app/api/users/route.ts
export async function DELETE(req, { params }) {
  await db.user.delete({ where: { id: params.id } });
}
```

**Good:**

```javascript
export const DELETE = withAuth(async (req, user, { params }) => {
  // Verify ownership
  if (item.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await db.user.delete({ where: { id: params.id } });
});
```

**Options:**

- `authWrappers`: Array of function names that provide auth. Default: `["withAuth", "withApiAuth", "withSession", "requireAuth", "authenticated"]`
- `publicRoutes`: Array of glob patterns for routes that don't need auth. Default: `[]`

### `require-useCallback`

Flags inline arrow functions in JSX event handler props.

**Bad:**

```jsx
<Button onClick={() => handleSubmit(data)} />
```

**Good:**

```jsx
const handleClick = useCallback(() => handleSubmit(data), [data]);
<Button onClick={handleClick} />;
```

**Options:**

- `ignoredProps`: Props to ignore (render props, etc). Default: `["render", "renderItem", "children", "component"]`
- `maxInlineHandlers`: Number of inline handlers allowed before warning. Default: `0`

### `require-guard-clause`

Flags division operations without zero-check guards.

**Bad:**

```javascript
const share = value / total;
```

**Good:**

```javascript
const share = total > 0 ? value / total : 0;
// OR
if (total === 0) return 0;
const share = value / total;
```

**Options:**

- `allowLiterals`: Allow division by non-zero literal numbers. Default: `true`

## Project Configuration

Create `.defensive-patterns.json` in your project root for project-specific settings:

```json
{
  "authWrappers": ["withAuth", "requireAuth", "withApiAuth"],
  "publicRoutes": ["**/api/health/**", "**/api/public/**", "**/api/webhook/**"]
}
```

This file is automatically read by `require-auth-middleware` rule.

## Why These Rules?

Standard ESLint and TypeScript checks miss these patterns because they're semantically valid code. The issues only manifest at runtime:

1. **JSON.parse** - Throws on invalid JSON, crashes your app
2. **Empty catch** - Silently swallows errors, users have no idea something failed
3. **Missing auth** - Security vulnerability, data exposure
4. **Inline handlers** - Performance death by a thousand cuts (re-render storms)
5. **Division by zero** - NaN/Infinity propagates through calculations, corrupting data

## License

MIT

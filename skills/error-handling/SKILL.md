---
name: error-handling
description: Auto-invoke skill for consistent error handling patterns. Activates when writing try/catch blocks, API error responses, form validation, async operations, or error boundaries. Enforces consistent patterns and flags anti-patterns like empty catches and silent failures.
---

# Error Handling Patterns Skill

Enforce consistent error handling across all projects. Flag anti-patterns proactively.

## When This Activates

- Writing try/catch blocks
- Creating API error responses
- Implementing form validation
- Writing async/await operations
- Adding error boundaries

## API Error Response Format

All API errors must follow this shape:

```typescript
{
  success: false,
  error: {
    code: "VALIDATION_ERROR",    // Machine-readable error code
    message: "Email is required", // Human-readable message
    details?: [...]              // Optional field-level errors
  }
}
```

**Status codes:**

- `400` - Validation error (bad input)
- `401` - Not authenticated
- `403` - Not authorized (authenticated but insufficient permissions)
- `404` - Resource not found
- `409` - Conflict (duplicate, stale data)
- `422` - Unprocessable entity (valid syntax, invalid semantics)
- `429` - Rate limited
- `500` - Internal server error (never expose stack traces)

## Async/Await Error Handling

```typescript
// Good: specific error handling with context
try {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError("User", id);
  return user;
} catch (error) {
  if (error instanceof NotFoundError) throw error;
  throw new DatabaseError("Failed to fetch user", { cause: error });
}

// Bad: silent catch, generic catch, no rethrow
try {
  await fetchData();
} catch (e) {} // Silent failure
try {
  await fetchData();
} catch (e) {
  return null;
} // Swallows error
```

## Validation Pattern (Zod at Boundaries)

Validate external data at system boundaries only:

```typescript
// API route: validate incoming request
const schema = z.object({ email: z.string().email(), name: z.string().min(1) });
const result = schema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Invalid input",
      details: result.error.flatten(),
    },
  });
}
// From here on, result.data is typed and safe
```

Boundaries: user input, API responses, env vars, file reads, URL params.
Internal code: trust TypeScript types, don't re-validate.

## Client-Side Error Boundaries

```typescript
// Wrap feature sections, not the entire app
<ErrorBoundary fallback={<FeatureError />}>
  <DashboardWidget />
</ErrorBoundary>
```

- One boundary per independent feature section
- Log errors to monitoring (Sentry, LogRocket, etc.)
- Show user-friendly fallback, not raw errors
- Include retry/refresh action in fallback UI

## Logging Requirements

**Log these:** error message, error code, request ID, user ID (if available), timestamp, stack trace (server-side only)

**Never log:** passwords, tokens, credit card numbers, PII beyond user ID, full request bodies with sensitive data

## Anti-Patterns to Flag

| Pattern                                      | Problem                        | Fix                          |
| -------------------------------------------- | ------------------------------ | ---------------------------- |
| `catch (e) { }`                              | Silent failure                 | Handle or rethrow            |
| `catch (e) { return null }`                  | Swallows error context         | Return error type or rethrow |
| `catch (e) { console.log(e) }`               | No recovery, user sees nothing | Add user-facing error state  |
| `catch (e: any)`                             | Loses type safety              | Use `unknown`, then narrow   |
| `res.status(500).json({ error: e.message })` | Leaks internals                | Use safe generic message     |
| `throw new Error("Error")`                   | Useless message                | Include what failed and why  |

---
name: api-conventions
description: Auto-invoke skill for consistent API design conventions. Activates when writing API routes, HTTP handlers, response objects, or REST endpoints. Enforces RESTful naming, consistent response shapes, proper status codes, Zod validation at boundaries, pagination, and rate limiting patterns.
---

# API Design Conventions Skill

Enforce consistent API design across all projects.

## When This Activates

- Writing API routes or HTTP handlers
- Creating response objects
- Designing REST endpoints
- Adding pagination or filtering
- Implementing rate limiting

## RESTful Resource Naming

```
GET    /api/users          → List users
GET    /api/users/:id      → Get single user
POST   /api/users          → Create user
PATCH  /api/users/:id      → Update user (partial)
PUT    /api/users/:id      → Replace user (full)
DELETE /api/users/:id      → Delete user

# Nested resources
GET    /api/users/:id/posts → List user's posts

# Actions (when CRUD doesn't fit)
POST   /api/users/:id/verify → Trigger verification
POST   /api/orders/:id/cancel → Cancel order
```

**Rules:**

- Plural nouns for resources (`/users` not `/user`)
- Kebab-case for multi-word (`/order-items` not `/orderItems`)
- No verbs in URLs (use HTTP methods instead)
- Max 2 levels of nesting

## Response Shape

All responses follow this shape:

```typescript
// Success
{ data: T, meta?: { page, limit, total } }

// Error
{ error: { code: string, message: string, details?: unknown } }
```

Never mix `data` and `error` in the same response. One or the other.

## HTTP Status Codes

| Method | Success                      | Common Errors                     |
| ------ | ---------------------------- | --------------------------------- |
| GET    | `200` with data              | `404` not found                   |
| POST   | `201` with created resource  | `400` validation, `409` conflict  |
| PATCH  | `200` with updated resource  | `400` validation, `404` not found |
| PUT    | `200` with replaced resource | `400` validation, `404` not found |
| DELETE | `204` no content             | `404` not found                   |

**Error status codes:** See error-handling skill for full list.

## Input Validation (Zod at Boundaries)

Every route handler validates input before processing:

```typescript
// Define schema
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["admin", "user"]).default("user"),
});

// Validate in handler
export async function POST(req: Request) {
  const body = await req.json();
  const result = createUserSchema.safeParse(body);
  if (!result.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          details: result.error.flatten(),
        },
      },
      { status: 400 },
    );
  }
  // result.data is typed and safe from here
}
```

## Pagination

Use cursor-based for large datasets, offset-based for simple cases:

```typescript
// Request
GET /api/posts?limit=20&cursor=abc123

// Response
{
  data: [...],
  meta: {
    limit: 20,
    cursor: "abc123",
    nextCursor: "def456",  // null if no more
    hasMore: true
  }
}
```

Default limit: 20. Max limit: 100. Always include `hasMore`.

## Rate Limiting

Return these headers on every response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

When exceeded, return `429 Too Many Requests` with:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "retryAfter": 60
  }
}
```

Include `Retry-After` header in seconds.

## Common Patterns

**Filtering:** Use query params: `GET /api/posts?status=published&author=123`

**Sorting:** `GET /api/posts?sort=createdAt&order=desc`

**Field selection:** `GET /api/users?fields=id,name,email` (optional, for bandwidth optimization)

**Idempotency:** POST/PATCH should accept `Idempotency-Key` header for safe retries.

# Authentication

All authenticated endpoints require a `Bearer` token in the `Authorization` header.

Tokens are JWTs issued on registration or login, valid for 7 days by default.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

## POST /auth/register

Create a new user account.

### Request Body

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `username` | string | Yes | 3–50 characters |
| `email` | string | Yes | Valid email |
| `password` | string | Yes | 6+ characters |

```bash
curl -X POST https://api.agon.win/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "email": "alice@example.com",
    "password": "s3cureP@ss"
  }'
```

### Response `201 Created`

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "alice"
  }
}
```

### Errors

| Status | Reason |
|--------|--------|
| 400 | Validation error (missing fields, short password, invalid email) |
| 409 | Username or email already exists |
| 500 | Internal server error |

---

## POST /auth/login

Authenticate with existing credentials.

### Request Body

| Field | Type | Required |
|-------|------|----------|
| `email` | string | Yes |
| `password` | string | Yes |

```bash
curl -X POST https://api.agon.win/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "s3cureP@ss"
  }'
```

### Response `200 OK`

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "alice"
  }
}
```

### Errors

| Status | Reason |
|--------|--------|
| 400 | Validation error |
| 401 | Invalid email or password |
| 500 | Internal server error |

---

## GET /auth/me

Get the current authenticated user's profile.

**Requires authentication.**

```bash
curl https://api.agon.win/auth/me \
  -H "Authorization: Bearer <token>"
```

### Response `200 OK`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "alice",
  "email": "alice@example.com",
  "chipBalance": 10000,
  "createdAt": "2026-03-11T10:00:00.000Z"
}
```

### Errors

| Status | Reason |
|--------|--------|
| 401 | Missing or invalid token |
| 404 | User not found |
| 500 | Internal server error |

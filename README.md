# File Nest — Backend API

RESTful OpenAPI 3.1 specification for file upload, version management, and shareable public links.

## 🔗 Open in Swagger Editor

[**▶ View the API in Swagger Editor**](https://editor.swagger.io/?url=https://raw.githubusercontent.com/parkkarl/file-nest-back/main/openapi.json)

Alternative viewers:
- [Redoc](https://redocly.github.io/redoc/?url=https://raw.githubusercontent.com/parkkarl/file-nest-back/main/openapi.json)
- [Swagger UI (petstore host)](https://petstore.swagger.io/?url=https://raw.githubusercontent.com/parkkarl/file-nest-back/main/openapi.json)

## Contents

- [`openapi.json`](./openapi.json) — full API specification
- [`src/`](./src) — Bun + Hono implementation (SQLite + drizzle-orm)

## Running locally

```bash
bun install
cp .env.example .env          # optional — defaults are fine for local dev
bun run db:migrate            # creates ./data/file-nest.db
bun run dev                   # starts on http://localhost:3000 (hot reload)
```

Endpoints are under `/v1`. Use the [Swagger Editor link](https://editor.swagger.io/?url=https://raw.githubusercontent.com/parkkarl/file-nest-back/main/openapi.json) to explore and try requests.

## Core features

- **Auth** — `POST /v1/auth/users` (register), `POST /v1/auth/sessions` (login), `DELETE /v1/auth/sessions/current` (logout); sessions tracked server-side so revocation is real
- **Upload** — `POST /v1/files` creates a new file and its first version; `POST /v1/files/{id}/versions` appends a new version
- **Version management** — each version is immutable, numbered, and separately addressable (`/v1/files/{id}/versions/{vid}`)
- **Share links** — `POST /v1/files/{id}/shares` creates a public link (optional password, expiry, download limit)
- **Public consumption** — `GET /v1/shares/{token}` and `GET /v1/shares/{token}/content` (no authentication required)

## RESTful design decisions

- Resource hierarchy in the URL (`/files/{id}/versions/{id}/content`)
- HTTP methods do the work — no verbs in the URL
- Proper status codes: `201 Created` + `Location`, `204 No Content`, `409`, `410`, `412`
- Metadata and binary content are separate resources
- HATEOAS — `_links` navigation in responses
- ETag + `If-Match` for optimistic concurrency
- Errors in RFC 7807 (`application/problem+json`) format
- Public vs. authenticated access via `security` schemes

## Viewing the spec

Open directly in Swagger Editor (no download required):

**https://editor.swagger.io/?url=https://raw.githubusercontent.com/parkkarl/file-nest-back/main/openapi.json**

Or import `openapi.json` into any OpenAPI tooling (Swagger UI, Redoc, Postman, Stoplight, IDE plugins).

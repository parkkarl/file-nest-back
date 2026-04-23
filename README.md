# File Nest — Backend API

RESTful OpenAPI 3.1 specification for file upload, version management, and shareable public links.

## Contents

- [`openapi.json`](./openapi.json) — full API specification

## Core features

- **Upload** — `POST /files` creates a new file and its first version; `POST /files/{id}/versions` appends a new version
- **Version management** — each version is immutable, numbered, and separately addressable (`/files/{id}/versions/{vid}`)
- **Share links** — `POST /files/{id}/shares` creates a public link (optional password, expiry, download limit)
- **Public consumption** — `GET /shares/{token}` and `GET /shares/{token}/content` (no authentication required)

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

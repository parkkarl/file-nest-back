# Failide jagamise ja versioonihalduse API

RESTful OpenAPI 3.1 spetsifikatsioon failide üleslaadimiseks, versioonihalduseks ja avalike jagatavate linkide loomiseks.

## Sisu

- [`openapi.yaml`](./openapi.yaml) — täielik API spetsifikatsioon

## Põhifunktsioonid

- **Upload** — `POST /files` loob uue faili ja esimese versiooni; `POST /files/{id}/versions` lisab uue versiooni
- **Versioonihaldus** — iga versioon on muutumatu, nummerdatud ja eraldi ligipääsetav (`/files/{id}/versions/{vid}`)
- **Jagatavad lingid** — `POST /files/{id}/shares` loob avaliku lingi (vabatahtlik parool, aegumine, allalaadimiste limiit)
- **Avalik tarbimine** — `GET /shares/{token}` ja `GET /shares/{token}/content` (autentimine pole vajalik)

## RESTful disainiotsused

- Ressursihierarhia URL-is (`/files/{id}/versions/{id}/content`)
- HTTP meetodid teevad tööd — URL-is ei ole verbe
- `201 Created` + `Location`, `204 No Content`, `409`, `410`, `412` staatuskoodid
- Metaandmed ja binaarne sisu on eraldi ressursid
- HATEOAS — vastustes `_links` navigatsioon
- ETag + `If-Match` optimistliku lukustuseks
- Vead RFC 7807 (`application/problem+json`) kujul
- Avalik vs privaatne ligipääs `security` skeemidega

## Vaatamine

Spetsifikatsiooni saab vaadata näiteks [Swagger Editoris](https://editor.swagger.io/) — ava seal `openapi.yaml`.

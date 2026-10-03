# Arcus Vendor Portal

A real website, served by an Express server in the main process on `localhost`, where vendors post invoices to Arcus. The agent can reach it only through browser tools.

## Pages
- `/login`: username, password, image captcha (`svg-captcha`)
- `/invoices`: vendor, invoice number, amount, status (paid, unpaid, overdue)
- `/invoices/:id`: details and "Download PDF"
- `/logout`

Server-rendered HTML with its own styling, so it reads as a separate system. Demo login: `demo` / `demo123`.

## Data
Stored in a separate `portal` schema that Finance tools cannot see. Invoice PDFs are generated at seed time with `pdf-lib` from fixtures, so they match ground truth exactly.

## Sessions
Cookie-based, with a configurable expiry.

## Fault injection
Middleware reads the active scenario and can:
- return 503 on a first request
- add latency
- expire the session mid-task
- serve an alternate page layout

## Why a real server
Real URLs, forms, cookies, redirects and HTTP errors make the browser tools and recovery genuine. Anyone can open the URL in a normal browser to check.
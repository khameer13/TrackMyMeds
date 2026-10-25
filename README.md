# TrackMyMeds

A small tool for a medical store to keep track of customers' regular medicines and see who needs a refill.

**Live demo:** https://khameer13.github.io/TrackMyMeds/

The live demo runs entirely in your browser with sample data (nothing is sent anywhere). Run the server below to store real data.

## Features

- Add, edit, search and delete customers (name, phone, email, address)
- Track each customer's medicines with the number of days of supply left
- Refill alerts for any medicine with 1 day or less left; colour-coded supply levels
- Background job on the server reduces supply by half a day every 12 hours and logs a reminder when a refill is due (an SMS hook is left in `sendReminder`)
- Works on mobile; follows light/dark mode

## Tech

- Front end: HTML, CSS, vanilla JavaScript (no build step)
- Back end: Node.js, Express 5, JSON file storage (`users.json`)

## Run locally

```bash
npm install
npm start          # http://localhost:3000
```

Open http://localhost:3000 — the page detects the server automatically.

Optional settings (environment variables):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `DATA_FILE` | `./users.json` | Where customer data is stored |
| `ALLOWED_ORIGINS` | `https://khameer13.github.io` | Comma-separated origins allowed by CORS |

HTTPS: put `key.pem` and `cert.pem` in a `certs/` folder and the server starts on HTTPS instead of HTTP.

### Use the hosted page with your own server

Open the live demo with `?api=<server URL>`, for example
`https://khameer13.github.io/TrackMyMeds/?api=http://localhost:3000`,
or click ⚙ on the page and choose **Server API**. Browsers allow an HTTPS page to call `http://localhost`, but any other server address needs HTTPS.

## API

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/users` | — | List of customers |
| POST | `/users` | customer | `201` created, `409` if the phone already exists |
| PUT | `/users/:phone` | customer (phone may change) | `200`, `404`, `409` |
| DELETE | `/users/:phone` | — | `200`, `404` |
| GET | `/api/health` | — | `{ "ok": true }` |

Customer shape:

```json
{
  "name": "Asha Rao",
  "phone": "9000000001",
  "email": "asha@example.com",
  "address": "MG Road, Bengaluru",
  "medicines": [{ "name": "Metformin 500mg", "daysLeft": 12 }]
}
```

## Tests

```bash
npm test
```

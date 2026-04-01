## Washa Backend

Express + MongoDB backend for the Washa Laundry Service app.

## Environment Variables

Create a local `.env` file from `.env.example`.

Required:

- `MONGODB_URI`
- `PORT`

Recommended for production:

- `AUTH_SECRET`
- `CORS_ORIGIN`

The server now fails fast at startup if `MONGODB_URI` is missing, and it requires `AUTH_SECRET` when `NODE_ENV=production`.
`CORS_ORIGIN` can be a comma-separated list of allowed frontend origins.

## Local Run

```bash
npm install
npm run dev
```

Health check:

```bash
GET /api/health
```

## Deploying On Pxxl App

This project is a Node/Express backend, so the expected settings are:

- Install command: `npm install`
- Build command: `npm run build`
- Start command: `npm start`
- Port: `9000`

Recommended deployment flow with the Pxxl CLI:

```bash
npm install -g pxxl-cli
pxxl auth
pxxl launch
pxxl env
pxxl ship
```

When `pxxl launch` detects the project, confirm or set:

- Runtime: `node`
- Framework: `Express` or `Node.js`
- Install command: `npm install`
- Build command: `npm run build`
- Start command: `npm start`
- Port: `9000`

Upload these environment variables in `pxxl env`:

- `MONGODB_URI`
- `PORT=9000`
- `AUTH_SECRET`
- `CORS_ORIGIN=https://washa.pxxl.click`
- `NODE_ENV=production`

## After Deployment

Check these URLs:

- `/`
- `/api/health`

If your frontend will call this API from another domain, make sure the frontend uses the deployed Pxxl URL for requests.

## Security Note

Do not commit real secrets. If your MongoDB connection string has ever been pushed or shared, rotate it before production deployment.

# College Bus Tracker

College bus tracking and management app with a Node.js/Express backend and a static frontend.

## Render deployment

This app runs as one Render web service. Use the repository root as the service root directory.

- Build command: `npm ci --prefix backend`
- Start command: `npm start --prefix backend`
- Runtime: Node.js
- Environment variables: `MONGODB_URI` and `JWT_SECRET`

The backend serves files from `frontend/` and binds to Render's `PORT`.

## Local run

Install the backend dependencies with `npm ci --prefix backend`, set `MONGODB_URI` and `JWT_SECRET` in your local environment, then run `npm start --prefix backend`.

Keep actual credentials in your local environment or the Render service settings. Do not commit them to this repository.

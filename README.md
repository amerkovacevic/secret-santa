# Secret Santa Coordinator

A modern React application for running Secret Santa gift exchanges. It uses Firebase Authentication for Google sign-in, Cloud Firestore for real-time data, and Tailwind CSS for styling.

## Features

- **Google sign-in** with Firebase Authentication.
- **Create and join groups** with shareable join codes (the Firestore document ID).
- **Real-time group updates** powered by Firestore listeners.
- **Organizer-only draws** so only the group creator can shuffle assignments.
- **Personal assignment view** so each member sees only their own giftee.

## Prerequisites

- Node.js 18 or newer.
- A Firebase project with Authentication (Google provider enabled) and Cloud Firestore.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and populate it with your Firebase project's credentials:

   ```bash
   cp .env.example .env.local
   ```

   Update `.env.local` with values from the Firebase console:

   ```dotenv
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

   The app is served at the URL printed in the terminal (typically `http://localhost:5173`).

## Usage tips

- Share a group's **join code** (displayed in the group details panel) so others can join from the dashboard.
- Once everyone has joined, the organizer can run the draw. Firestore updates propagate instantly so every member sees their match right away.
- Consider adding Firestore security rules that restrict updates to the group owner and members as appropriate for production deployments.

## Scripts

- `npm run dev` – Launch the Vite development server.
- `npm run build` – Type-check and produce a production build.
- `npm run preview` – Preview the production build locally.
- `npm run lint` – Run ESLint over the project.

## License

This project is provided under the [MIT license](LICENSE).

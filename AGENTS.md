# Agent Instructions & Project Hazards

## Tech Stack Constraints (DO NOT VIOLATE)
*   **Deployment Target:** Vercel (Static / Serverless).
*   **No Heavy Backends:** Absolutely NO Python, Docker, or heavy SQL/Vector DB dependencies (e.g., pgvector, ChromaDB).
*   **Database Simulation:** All SpiceDB permission checks and vector search steps must be simulated in client-side JavaScript (`app.js`) to keep the build lightweight and compatible with standard static hosting.

## Known Landmines & Friction Points
*   **Tailwind CDN Warning:** We are using vanilla CSS or a lightweight CSS framework in a single file. Do not attempt to install npm packages for styling unless explicitly requested.
*   **File Upload Limit:** The "Ingest" simulator expects file sizes under 5MB. Do not write chunking logic; keep the file reading in-memory using the browser's `FileReader` API.
*   **State Management:** Active identity (Paul, Gurney, Harkonnen) and uploaded file metadata are tracked in a global `gameState` object in `app.js`. Do not desynchronize this state when updating the UI.
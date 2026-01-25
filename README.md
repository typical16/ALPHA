 # Alpha — Chat app (OpenRouter proxy)

Short, friendly summary for LinkedIn: Alpha is a modern, mobile-first chat UI built with React + Vite that proxies requests through a lightweight Node/Express backend to OpenRouter. It stores conversation history in the browser (no database) and is designed for easy local development and simple cloud deployment (Vercel + Render).

Live demo: https://alpha-f9hm.onrender.com/ (backend) • Frontend: (your Vercel URL)

**Highlights**
- Human-like conversation behavior via a configurable system prompt
- Clean, responsive UI with TailwindCSS
- Client-side chat history (no server DB) and lightweight proxying for API keys
- Easy to run locally and deploy to Vercel (frontend) + Render (backend)

**Tech**: React 18, Vite, TailwindCSS, Node.js, Express, Axios, OpenRouter

Overview
```
backend/   # Express server, /api/chat proxy to OpenRouter
frontend/  # React + Vite + Tailwind app
```

Quick start (local)

1) Backend
```powershell
cd backend
copy .env.example .env   # Windows PowerShell/cmd
# Edit backend/.env and set OPENROUTER_API_KEY
npm install
npm run dev
```

2) Frontend
```powershell
cd frontend
npm install
npm run dev
```

Open your browser at `http://localhost:5173` to use the app.

What to configure
- `backend/.env` — set `OPENROUTER_API_KEY`, `ORIGIN`, and `HTTP_REFERER`.
- `frontend/.env.production` — set `VITE_API_BASE_URL` to your backend URL for production.

Deployment notes
- Frontend: deploy `frontend` to Vercel (set `VITE_API_BASE_URL` in Vercel env vars if preferred).
- Backend: deploy `backend` to Render (set `OPENROUTER_API_KEY`, `ORIGIN`, `HTTP_REFERER`).

Troubleshooting tips
- If deployed responses sound different from local, check the `SYSTEM_PROMPT` environment variable on the backend — the prompt controls assistant tone/behavior.
- If requests fail with CORS errors, ensure `ORIGIN` matches the frontend domain or allow your Vercel domain.
- For OpenRouter 401/authorization errors, verify the API key is active and has access to the requested model.

Share on LinkedIn
- Short blurb you can copy:

"Launched Alpha — a modern, mobile-friendly chat UI that proxies to OpenRouter. Built with React + Vite on the frontend and Node/Express on the backend. Live demo + source code available. Feedback welcome! 🔗 [repo link]"

License
MIT

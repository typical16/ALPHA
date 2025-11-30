# ChatGPT-like App via OpenRouter

A modern, responsive chat app using React + Vite + Tailwind on the frontend and Node.js/Express on the backend. The backend securely proxies requests to OpenRouter using an API key from environment variables. Chat history is stored entirely on the client via `localStorage`.

## Features
- Modern, mobile-friendly UI with TailwindCSS
- Smooth scrollable chat with distinct user/AI bubbles
- Message box fixed at the bottom; Enter to send, Shift+Enter for newline
- Typing indicator while waiting for AI response
- Persistent chat history via `localStorage` and a button to clear history
- Graceful error messages on API failures

## Tech Stack
- Frontend: React 18, Vite, TailwindCSS
- Backend: Node.js, Express, Axios
- API Provider: OpenRouter (`https://openrouter.ai`)

## Project Structure
```
backend/   # Express server, /api/chat proxy to OpenRouter
frontend/  # React + Vite + Tailwind app
```

## Prerequisites
- Node.js 18+
- An OpenRouter API key (`https://openrouter.ai/keys`)

## Setup

### 1) Backend
```
cd backend
copy .env.example .env   # Windows PowerShell/cmd
# Edit .env and set OPENROUTER_API_KEY
npm install
npm run dev
```
- The server listens on `http://localhost:3001` by default.
- The `ORIGIN` in `.env` controls CORS (defaults to `http://localhost:5173`).
- Health check: `GET http://localhost:3001/health`

Environment variables (`backend/.env`):
```
OPENROUTER_API_KEY=YOUR_KEY_HERE
HTTP_REFERER=http://localhost:5173
APP_TITLE=Local ChatGPT via OpenRouter
PORT=3001
ORIGIN=http://localhost:5173
```

### 2) Frontend
```
cd frontend
npm install
npm run dev
```
- App runs at `http://localhost:5173`.
- Vite dev server proxies `/api` and `/health` to the backend.

## Usage
1. Open the frontend in your browser.
2. Type a message and press Enter to send (Shift+Enter for newline).
3. Responses come back after the backend calls OpenRouter.
4. Click "Clear" to remove chat history from local storage.

## Notes
- All conversation data is kept in the browser; no external database is used.
- The backend only forwards messages and returns the assistant’s text.
- You can change the model by sending `model` in the request from the frontend (defaults to `openai/gpt-4o-mini`).

## Deploying

### Option 1: One-Click Deploy to Vercel (Recommended)

1. **Fork this repository** to your GitHub account
2. **Get your OpenRouter API key** from https://openrouter.ai/keys
3. **Deploy to Vercel:**
   - Go to [vercel.com](https://vercel.com) and sign in with GitHub
   - Click "New Project" and import your forked repository
   - In Environment Variables, add:
     - `OPENROUTER_API_KEY`: Your OpenRouter API key
     - `ORIGIN`: Your Vercel domain (will be auto-generated)
     - `HTTP_REFERER`: Your Vercel domain (will be auto-generated)
   - Click "Deploy"
   - Your app will be live at your Vercel URL!

### Option 2: Manual Deployment

1. **Set up environment variables** (copy from `env.example`):
   ```
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   ORIGIN=your_domain_here
   HTTP_REFERER=your_domain_here
   APP_TITLE=Alpha Chat App
   NODE_ENV=production
   ```

2. **Install dependencies and build:**
   ```bash
   npm run install:all
   npm run build
   ```

3. **Start the application:**
   ```bash
   npm start
   ```

### Environment Variables for Production
- `OPENROUTER_API_KEY`: Your OpenRouter API key (required)
- `ORIGIN`: Your frontend domain for CORS
- `HTTP_REFERER`: Your app's URL for OpenRouter
- `APP_TITLE`: Your app's title
- `NODE_ENV`: Set to "production"

## License
MIT

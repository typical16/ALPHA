# One-Click Deployment to Vercel

## 🚀 Deploy with One Click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/YOUR_REPO_NAME)

## 📋 Pre-Deployment Checklist

Before deploying, make sure you have:

1. ✅ **OpenRouter API Key** - Get yours at [openrouter.ai/keys](https://openrouter.ai/keys)
2. ✅ **GitHub Account** - To fork this repository
3. ✅ **Vercel Account** - Sign up at [vercel.com](https://vercel.com)

## 🔧 Environment Variables Setup

When deploying on Vercel, you'll need to set these environment variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | Your OpenRouter API key (required) |
| `ORIGIN` | `https://your-app.vercel.app` | Your Vercel domain (auto-generated) |
| `HTTP_REFERER` | `https://your-app.vercel.app` | Your Vercel domain (auto-generated) |
| `APP_TITLE` | `Alpha Chat App` | Your app's title (optional) |
| `NODE_ENV` | `production` | Environment setting (auto-set) |

## 🎯 Step-by-Step Deployment

### Method 1: Deploy Button (Easiest)

1. **Fork this repository** to your GitHub account
2. **Click the "Deploy with Vercel" button** above
3. **Connect your GitHub account** if prompted
4. **Select your forked repository**
5. **Add environment variables:**
   - Click "Environment Variables" 
   - Add `OPENROUTER_API_KEY` with your API key
   - Other variables will be auto-populated
6. **Click "Deploy"**
7. **Wait for deployment** (usually 1-2 minutes)
8. **Visit your live app** at the provided Vercel URL!

### Method 2: Manual Vercel Dashboard

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your forked repository
4. Configure environment variables as shown above
5. Click "Deploy"

## 🔍 Troubleshooting

### Common Issues:

**❌ "OPENROUTER_API_KEY is not set"**
- Solution: Add your OpenRouter API key to environment variables

**❌ "CORS Error"**
- Solution: Make sure `ORIGIN` is set to your Vercel domain

**❌ "Build Failed"**
- Solution: Check that all dependencies are properly installed in package.json

### Getting Help:

- Check the [Vercel Documentation](https://vercel.com/docs)
- Review the [OpenRouter API Docs](https://openrouter.ai/docs)
- Open an issue in this repository

## 🎉 Success!

Once deployed, your chat app will be live and accessible to anyone with the URL. The app features:

- 🤖 AI-powered conversations via OpenRouter
- 📱 Mobile-responsive design
- 💾 Local storage for chat history
- ⚡ Fast loading with Vercel's global CDN
- 🔒 Secure API key handling

Enjoy your new AI chat app! 🚀

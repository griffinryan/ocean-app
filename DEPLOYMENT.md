# Deployment Configuration

This document outlines the deployment configuration required for the Ocean Portfolio application.

## AWS Amplify Configuration

The application uses clean URL routing (HTML5 History API) which requires server-side configuration to properly handle direct URL access and browser navigation.

### Required Redirect Rule

**IMPORTANT:** You must configure the following redirect rule in AWS Amplify to enable clean URL routing.

#### Where to Configure

1. Log in to the AWS Amplify Console
2. Navigate to your Ocean Portfolio app
3. Go to **App Settings** → **Rewrites and redirects**
4. Add the following rule:

#### Redirect Rule Configuration

```
Source address:    </^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|pdf|html|glb)$)([^.]+$)/>
Target address:    /index.html
Type:              200 (Rewrite)
```

#### What This Rule Does

- **Matches:** All paths that don't have a file extension, OR paths with extensions NOT in the exclusion list
- **Action:** Rewrites them to `/index.html` with HTTP 200 status (not a redirect)
- **Result:** Allows the JavaScript router to handle the path client-side
- **Preserves:** Static assets (CSS, JS, images, fonts, GLSL shaders, PDFs, 3D models, etc.) pass through normally

#### Why This Is Needed

With clean URLs like `/app`, `/portfolio`, `/resume`:

1. **Without the rule:** User visits `/app` → Server looks for `/app/index.html` → Returns 404 → User sees error
2. **With the rule:** User visits `/app` → Server rewrites to `/index.html` → Returns 200 → JavaScript router handles `/app` path → Correct page displays

#### Testing the Configuration

After adding the redirect rule:

1. **Direct URL Access:**
   - Visit `https://griffinryan.com/app` directly in browser
   - Visit `https://griffinryan.com/portfolio`
   - Visit `https://griffinryan.com/resume`
   - All should load successfully without 404 errors

2. **Browser Navigation:**
   - Click navigation links
   - Use browser back/forward buttons
   - Refresh the page while on a route
   - All should maintain proper state

3. **Asset Loading:**
   - Check browser DevTools Network tab
   - Verify all CSS, JS, images, fonts load correctly
   - Verify no 404 errors for static assets

4. **404 Handling:**
   - Visit an invalid route like `/nonexistent`
   - Should show the application's custom 404 state (not AWS error page)

## Build Configuration

The application is built using Vite with the following commands:

```bash
# Development server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

### Build Output

- **Output Directory:** `dist/`
- **Build Process:** TypeScript compilation (`tsc`) followed by Vite bundling
- **Source Maps:** Enabled in production for debugging
- **Base Path:** `/` (configured in `vite.config.ts`)

## Deployment Workflow

The AWS Amplify build process:

1. Detects changes to the repository (push to main branch)
2. Runs `yarn install --frozen-lockfile`
3. Runs `yarn build` (= `tsc && vite build`)
4. Serves files from `dist/` directory
5. Applies redirect rules to incoming requests

## Alternative Hosting Providers

If migrating to a different hosting provider, you'll need equivalent SPA fallback configuration:

### Netlify

Create `public/_redirects`:
```
/*    /index.html   200
```

### Vercel

Create `vercel.json`:
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### Apache (.htaccess)

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

### Nginx

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

## Performance Considerations

The clean URL implementation maintains **zero performance impact** on the rendering pipeline:

- ✅ No additional RAF loops
- ✅ Same transition timing (2-frame RAF wait preserved)
- ✅ Same scroll coordination with glass renderer
- ✅ Same position caching and batch update logic
- ✅ All critical timing preserved exactly

The only difference is the URL format:
- **Before:** `griffinryan.com/#/app`
- **After:** `griffinryan.com/app`

All renderer systems (ocean, wake, glass, text, blur) are completely unaffected by this change.

## Troubleshooting

### Issue: Direct URL access returns 404

**Cause:** Redirect rule not configured or incorrect

**Solution:** Verify the redirect rule is added to AWS Amplify with the exact regex pattern shown above

### Issue: Static assets return 404

**Cause:** Redirect rule is matching static assets incorrectly

**Solution:** Ensure the file extension exclusion list includes all necessary types:
- `.css`, `.js` - Stylesheets and scripts
- `.png`, `.jpg`, `.gif`, `.svg`, `.ico` - Images
- `.woff`, `.woff2`, `.ttf` - Fonts
- `.json` - Manifests and data
- `.pdf` - Documents
- `.glb` - 3D models
- `.map` - Source maps

### Issue: Browser back button doesn't work

**Cause:** JavaScript error or router not initializing

**Solution:** Check browser console for errors. Verify Router is initialized before first navigation.

### Issue: Page shows old content after navigation

**Cause:** Browser caching aggressive settings

**Solution:**
1. Hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
2. Clear browser cache
3. Check AWS Amplify cache settings

## Monitoring

After deployment, monitor these metrics:

1. **Page Load Time:** Should remain consistent with hash routing
2. **Frame Rate:** Should maintain 60 FPS target
3. **Transition Timing:** Glass/text renderer transitions should be smooth
4. **Console Errors:** Watch for any routing-related errors
5. **404 Rates:** Should only occur for genuinely invalid routes

## Rollback Procedure

If issues occur after deployment:

1. Revert the Git commits containing the routing changes
2. Redeploy the previous version via AWS Amplify
3. Remove the redirect rule (optional, won't break hash routing)
4. Investigate issues before re-attempting migration

Cyphronex-Bluevane - flat web app (everything in this one folder, no build step)

PAGES (hash-routed, each its own page)
  #/chats      1:1 end-to-end encrypted chats + contacts
  #/groups     group conversations
  #/channels   broadcast channels (subscribed + Discover public channels)
  #/status     24-hour statuses (text or photo)
  #/settings   profile, personal themes, security keys, install, sign out

SET UP SUPABASE (once)
  1. Create a project at supabase.com.
  2. SQL Editor > paste all of supabase_schema.sql > Run. (Creates tables, security
     rules, helper functions, storage buckets and realtime.)
  3. Authentication > Providers: Email is on by default. For quick testing you can turn
     off "Confirm email"; otherwise new users must click the emailed link.
  4. Project Settings > API: copy the Project URL (https://xxxx.supabase.co, no /rest/v1/)
     and the anon / publishable key. NEVER use the service_role / secret key.
  5. Either paste them into config.js before deploying, or leave config.js empty and the
     app asks for them on first launch (saved in that browser only).

RUN LOCALLY
  python3 -m http.server 8080      then open http://localhost:8080
  (must be served over http(s); opening index.html as a file:// will not work.
   Encryption needs https:// or localhost.)

DEPLOY AS A WEB APP
  Upload this whole folder to any static host (Netlify, Vercel, Cloudflare Pages,
  GitHub Pages, cPanel...). It must be served over HTTPS. In Chrome/Edge use the install
  icon in the address bar; on iPhone/iPad use Share > Add to Home Screen.
  After deploying, add your site URL under Supabase > Authentication > URL Configuration
  (Site URL) so email links and password resets point to it.

PRIVACY MODEL
  - Direct chats and their files: end-to-end encrypted (ECDH P-256 + AES-256-GCM). The
    private key stays in the browser; back it up in Settings > Security to use another device.
  - Groups and channels: protected by TLS and row-level security, NOT end-to-end encrypted.
  - Email and phone are stored in a private table and can only be matched exactly when
    someone searches for them; they are never listed.

FILES
  index.html styles.css app.js ui.js theme.js themes.js crypto.js config.js
  sw.js (offline app shell) manifest.json favicon.svg icon-*.png supabase_schema.sql

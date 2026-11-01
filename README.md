# Aruni Chatrabas

A bilingual (Bangla/English), responsive starter website for Aruni Chatrabas.

## Phase 1 contents
- Responsive landing page (`index.html`)
- Login placeholder (`login.html`)
- Dashboard UI preview (`dashboard.html`)
- Bangla/English language toggle
- Bootstrap 5.3.7 and custom CSS
- GitHub Pages-ready relative asset paths

## Technology direction
- Frontend: HTML, CSS, JavaScript, Bootstrap
- Backend (Phase 2): Supabase Auth + PostgreSQL
- Hosting: GitHub Pages

## Run locally
Open `index.html` in a browser, or use VS Code Live Server.

## Publish with GitHub Pages
1. Push the project files to the `main` branch.
2. Open repository Settings → Pages.
3. Under Build and deployment, choose **Deploy from a branch**.
4. Select `main` and `/ (root)`, then Save.
5. Wait for the deployment URL to appear.

## Important security note
This Phase 1 release is a UI scaffold only. Login is not active and no real financial data is stored.
GitHub Pages hosts static, publicly accessible files. In Phase 2, private member/account data must be protected by Supabase Authentication and PostgreSQL Row Level Security (RLS). Never put a Supabase `service_role` key or other secrets in frontend code.

## Planned next phases
- Phase 2: Supabase project, schema, authentication, roles, and RLS policies
- Phase 3: Member and manager records
- Phase 4: Deposits, expenses, meals, and monthly calculations
- Phase 5: Reports, exports, audit history, and testing

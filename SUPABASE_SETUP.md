# Supabase setup — Aruni Chatrabas

This repository is the frontend. Supabase provides private authentication and the PostgreSQL database.

## 1. Create a Supabase project
1. Open https://supabase.com/ and create a project.
2. Choose a strong database password and keep it private.
3. Select a nearby region if available.
4. Wait for the database to finish provisioning.

## 2. Create the database tables and security policies
1. In the Supabase project, open **SQL Editor**.
2. Open `supabase/schema.sql` from this repository.
3. Copy the complete SQL into a new SQL query and run it.
4. Confirm the tables appear under **Table Editor**.

The schema creates profiles, members, monthly periods, deposits, expenses, meal entries, meal rates, notices, audit logs, and Row Level Security policies.

## 3. Configure authentication
1. Open **Authentication → Providers** and enable Email.
2. For a private mess system, keep public self-registration disabled in the app. Accounts should be created/invited by an administrator.
3. Configure the site's URL and allowed redirect URLs after GitHub Pages is enabled.
4. Decide whether email confirmation is required.

## 4. Promote the first administrator
1. Create the first trusted user through Supabase Authentication.
2. In **Authentication → Users**, copy that user's UUID.
3. In **SQL Editor**, run this query after replacing the placeholder:

```sql
update public.profiles
set role = 'admin'
where id = 'YOUR-AUTH-USER-UUID';
```

Do not give admin access to an untrusted account.

## 5. Get the frontend connection values
Open **Project Settings → API** (or **Data API**) and copy:
- Project URL
- Publishable key (or legacy anon public key)

These values are designed for browser use when Row Level Security is correctly enabled. Never put the **service_role** key or database password in HTML, JavaScript, GitHub, or any browser-visible file.

## 6. Current project status
- Phase 1: bilingual static website and dashboard preview.
- Phase 2 foundation: database schema and RLS policies.
- Not yet connected: the login form and dashboard still use placeholder/demo behavior until the project URL and publishable key are configured and the frontend integration is implemented.

## Security notes
- GitHub Pages serves public static files; it does not make the source code private.
- RLS is essential. Test using separate member, manager, and admin accounts before storing real financial or personal data.
- The current policies allow authenticated members to see shared mess expenses and published notices, while restricting personal deposits/meals to the member concerned and staff.
- Role changes should be performed only by a trusted administrator. Do not expose privileged keys in the frontend.

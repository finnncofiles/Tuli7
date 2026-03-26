TULI7 launch package

Files:
- index.html
- app.js
- supabase.sql

Deploy order:
1. Create a Supabase project.
2. Open SQL Editor and run supabase.sql.
3. In app.js, replace:
   - PASTE_YOUR_SUPABASE_URL_HERE
   - PASTE_YOUR_SUPABASE_ANON_KEY_HERE
4. Upload index.html and app.js to the root of your GitHub Pages repo.
5. Open the published site and test:
   - trainer creates session
   - player joins with name + PIN
   - trainer sees roster

This package is intentionally focused on stable session flow first.
Map and geofence features should be added only after this flow is confirmed working.

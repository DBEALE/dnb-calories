Now the deploy steps. Run these from the worker directory:

  # 1. Apply the schema to D1 (one-time setup)
  wrangler d1 execute calorie-tracker-sync --file=schema.sql

  # 2. Deploy the worker
  wrangler deploy

  If you haven't installed dependencies yet:
  npm install
  wrangler deploy

  To verify the schema was applied:
  wrangler d1 execute calorie-tracker-sync --command="SELECT name FROM sqlite_master WHERE type='table'"

  You should see food_entries, weight_entries, favourites, profile listed. After that the worker is live and the client
  will start syncing automatically on next page load.

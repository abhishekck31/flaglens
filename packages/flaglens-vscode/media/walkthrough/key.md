# Get an Organisation API key

1. Open the dashboard and **sign up**. On a new instance, the first user is the admin.
2. Create an organisation if asked.
3. Go to **Organisation Settings → API Keys → Create API Key** and copy it.

It must be an **Organisation** API key. Environment (SDK) keys can only read flags for one environment.
FlagLens keeps the key in your OS keychain (VS Code SecretStorage), never in settings or files.

Optional: copy `flagsmith.env.example` to `flagsmith.env`, paste the key, and run `npm run seed` for the demo project.

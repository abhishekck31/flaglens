# Start self-hosted Flagsmith

FlagLens works with **self-hosted** Flagsmith. In the FlagLens repository, **Start local Flagsmith** runs
`docker compose up -d` in a terminal (image pinned to `2.295.2`) and waits for the health check.

- Needs Docker Desktop running.
- The first start pulls images and runs database migrations, so it can take a few minutes.
- If Flagsmith is already running, FlagLens asks first and never stops or restarts it.

Dashboard and API: <http://localhost:8000>

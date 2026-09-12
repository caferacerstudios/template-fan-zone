# Ticketmaster development runbook (compatibility pointer)

> Historical path: the operational content formerly here is consolidated into [`../ticket-sync-deployment.md`](../ticket-sync-deployment.md). See [`README.md`](README.md) for current Ticketmaster behavior and [`../ticket-sync.md`](../ticket-sync.md) for exact configuration.

Use the development instance and paths in the deployment runbook. Keep development separate from production, keep `SFZ_TICKET_DATA_MODE` out of the secret sync environment, and do not enable season discovery until an operator has installed a verified {Team} attraction ID. Git history retains the older dev-specific procedure.

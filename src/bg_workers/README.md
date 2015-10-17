#noobaa-core bg_workers
===========
bg_workers contains the background workers such as the build chunks worker and the cloud sync worker.
They have been split out from the MD server into their own process.

bg_workers_rpc - RPC entry point for the bg workers process.

bg_workers_starter - "main" of the bg workers process, inits and registration of actual background worker items.

build_chunks_worker - Rebuilding chunks which are not in optimal state.

cloud_sync - actual cloud_sync data flows, configuration done via the the MD server, data flow from here.

redirector - holds a map of all agents and the server which holds them, redirects needed RPC requests to the appropriate server.

To run locally:
```node src/bg_workers/bg_workers_starter.js```

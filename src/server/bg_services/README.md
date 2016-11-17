#noobaa-core bg_workers
===========

bg_workers contains the background workers such as the build chunks worker and the cloud sync worker.
They have been split out from the MD server into their own process.

scrubber - Rebuilding chunks which are not in optimal state.

cloud_sync - actual cloud_sync data flows, configuration done via the the MD server, data flow from here.

To run locally:
```node src/server/bg_workers.js```

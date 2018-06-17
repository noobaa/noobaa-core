#noobaa-core bg_workers
===========

bg_workers contains the background workers such as the build chunks worker.
They have been split out from the MD server into their own process.

scrubber - Rebuilding chunks which are not in optimal state.

To run locally:
```node src/server/bg_workers.js```

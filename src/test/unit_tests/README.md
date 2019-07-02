#noobaa-core Unit Tests
===========
###Unit Tests Table of Contents:

* [coretest](#coretest) - Core Test Infrastructure

* ###coretest
  This module will function as somewhat of a proxy to the different components control modules
  (agents, clients etc.). It provides its own API:

    1) client - Return the rpc client

    2) new_client - Allocate and return a new client

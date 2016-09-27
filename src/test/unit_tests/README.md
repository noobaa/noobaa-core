#noobaa-core Unit Tests
===========
###Unit Tests Table of Contents:

* [core_agent_control](#core_agent_control) - Agent Control Testing Infrastructure
* [coretest](#coretest) - Core Test Infrastructure


* ###core_agent_control
  This module provides agent control API for our testing infrastructure.
  Currently it holds the logic to work with local agents (with the MemoryStore), if the future
  it will be expanded to work with remote clients (EC2) as well.

  The module provides Control API:

    1) create_agent(howmany) - Creates howmany new agents

    2) stop_agent (agent_name) - Stops a specific agents

    3) start_agent (agent_name) - Starts a specific agent

    4) start_all_agents - Starts all agents

    5) stop_all_agents - Stops all agents

    6) cleanup_agents - Stops and clears all agents

  And Helpers:

    1) get_agents_list - Return a list of the allocated agents and their status (started/stopped)

  Using the module for local agents require initializing it with the use_local_agents() API.
  This API expects to receive the following parameters:
    auth_token - The auth token for the agents to be created with

* ###coretest
  This module will function as somewhat of a proxy to the different components control modules
  (agents, clients etc.). It provides its own API:

    1) client - Return the rpc client

    2) new_client - Allocate and return a new client

    3) init_test_nodes(client, system, count) - Performs the following
        1. Creates Auth Token for new agent in the system,
        2. Sets the agent control to work locally (will be removed once we support remote),
        3. Starts all stopped agents

    4) clear_test_nodes - Stops all agents and then clears them

  In addition, it exposes all the core_agent_control API.

  In the future, will expose all the client control API as well.

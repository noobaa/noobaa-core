#noobaa-core tests
===========
###Core Tests Table of Contents:

* [core_agent_control](#core_agent_control) - Agent Control Testing Infrastructure.


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

  I/O API:
    1) read_block(node_name, block_id) - Reads and returns block_id on node_name
    2) write_block(node_name, block_id, data) - Writes data to block_id on node_name
    3) delete_blocks(node_name, block_ids) - Deletes all block_ids from node_name
    4) corrupt_blocks(node_name, block_ids) - Corrupts (hash corruption) all block_ids on node_name

  And Helpers:
    1) get_agents_list - Return a list of the allocated agents and their status (started/stopped)

  Using the module for local agents require initializing it with the use_local_agents() API.
  This API expects to receive the following parameters:
    utilitest - Reference to the utilitest module
    auth_token - The auth token for the agents to be crated with

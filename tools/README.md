#tools
===========
Tools contains various tools which are not part of the working flows but can be used for debug, support and even testing.

###Tools Table of Contents:

* [rpc_shell](#rpc_shell) - Invoke RPC commands.


* ###rpc_shell
  A command line shell (using repl) to invoke RPC commands on the different servers (MD, BGWorkers).
  currently supports the following control commands:
    - .list_functions - Shows all control commands.
    - .list - Shows all API categories.
    - .show <API> - show all available RPC functions under a given API category.
    - .call <API> <FUNC> [ARGS] - Invokes the RPC call API.FUNC and passes ARGS as arguments to the call.
      Arguments should be provided with the '=' sign notation.
      For example :

      ___node.list_nodes({
        query: {
          pool: 'default_pool',
        }
      })___

      Is done in the following way:

      ___.call node list_nodes query={pool='default_pool'}___

  Currently rpc_shell does not support argument execution mode (i.e. node rpc_shell.js .call system read_system),
  but can be added should the need arise (in testing scenarios for example).

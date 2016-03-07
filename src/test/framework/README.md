#noobaa-core tests framework
===========
Single point for smoke/regression tests runs. Define which tests and order, cleaning steps etc.

The framework consists of the runner and the flow.json

flow.json is the description of the run, it is build as an array of steps, running sequencially.

Each step has the following:

1) name: The name of the step
2) action: command line to perform (i.e. run a test)
3) common: use a common functionality from the runner (i.e. restore db to defaults)
4) blocking: if set to true, failure in this step would stop the chain
5) args: if the action requires arguments, supply an array of arguments

NOTE: common and action are mutual exclusive

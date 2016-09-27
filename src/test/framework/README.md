# Noobaa-Core Tests Framework
Single point execution for smoke/regression tests runs. Define which tests to run, their order, cleaning steps etc.

The framework consists of the runner, istanbul_coverage the flow.json.

## Runner
Runner holds the logic of the framework. It provides the ability to pass arguments to each of the defined tests, it cleans previous test run report & coverage info and generates new ones. The package containing the final report and coverage files is uploaded to the local system under files:/res_<VERSION>.tgz

Runner also implements common logic such as restore db to default state (as if the system was just created + the nodes which were up previously).

Arguments passed to Runner:

1) --GIT_VERSION - Must be supplied, the git version of the Build

2) --FLOW_FILE - Optional, provide an alternate scenario file. If not supplied will use flow.js


## Istanbul_coverage
Istanbul coverage hooks and instruments our code for the purpose of coverage reports. It is being required by each server (and each member of the node cluster) in cases TESTRUN is true (the Runner sets the supervisor to run services with --TESTRUN beginning and removes it upon completion and restarts the services)

It defines the coverageVariable for istanbul to be 'NOOBAA_COV'

## Flow.js
flow.js is the description of the run, it is build as an array of steps, running sequentially.

Each step can be configured in the following manner:

1) **name**: The name of the step. This name will be written to the final report.

2) **action** OR **common**:
- action: Command to perform, examples: 'src/test/system_tests/test_files_spread.js' or 'npm run mocha'
- common: Run a common functionality the framework provides, example: 'restore_db_defaults'

3) **blocking**: If set to true, failure in this step would stop the entire chain

4) **params**: If the action requires parameters, supply an array of parameters. These parameters are chained according to order when the command is executed.

   Each param can be one of two types:
- arg for a static param, its value provided inline, for example _arg: '5'_
- input_arg for a dynamic value param, its value provided to the runner as argv when its being run, for example _input_arg: 'ip'_ would result in evaluating the value for the --ip parameter sent for the runner execution (node runner.js --ip 127.0.0.1)

5) ***lib_test***: test which is exported as a library, will be required and run_test() will be invoked.

So an whole step can look something like:

```
{
    name: 'Upgrading to new version',
    action: 'node src/test/system_tests/sanity_build_test.js',
    params: [{
        arg: '--upgrade_pack',
    }, {
        input_arg: 'upgrade_pack',
    }, {
        arg: '--target_ip',
    }, {
        arg: '127.0.0.1',
    }],
    blocking: true,
}
```

Assuming the runner was run in the following manner:

` ``node runner.js --upgrade_pack /tmp/pack.tar.gz`

This step, called "Upgrading to new version" will be executed with the following command: _node src/test/system_tests/sanity_build_test.js --upgrade_pack /tmp/pack.tar.gz --target_ip 127.0.0.1_

If this step would fail, the runner will not continue to the next step.

## Future Thoughts
Not implemented yet, need to think and see if the following is needed
- Skip to a certain point in flow.js
- Stop at a certain point in flow.js
- Add coverage hooks to agents and S3
- Specific errors integration for tests and not entire test failure message

Not exactly framework related, but get coverage for S3 and Agent code.

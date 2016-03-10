#Noobaa-Core Tests Framework
===========
Single point execution for smoke/regression tests runs. Define which tests to run, their order, cleaning steps etc. 

The framework consists of the runner, istanbul_coverage the flow.json.

###Runner
Runner holds the logic of the framework. It provides the ability to pass arguments to each of the defined tests, it cleans previous test run report & coverage info and generates new ones. The package containing the final report and coverage files is uploaded to the local system under files:/res_<VERSION>.tgz

Runner also implements common logic such as restore db to default state (as if the system was just created + the nodes which were up previously).

###Istanbul_coverage 
Istanbul coverage hooks and instruments our code for the purpose of coverage reports. It is being required by each server (and each member of the node cluster) in cases TESTRUN is true in .env (the Runner sets to to true at the beginning and to false upon completion and restarts the services)

It defines the coverageVariable for istanbul to be 'NOOBAA_COV'

###Flow.js
flow.js is the description of the run, it is build as an array of steps, running sequentially.

Each step can be configured in the following manner:

1) __name__: The name of the step. This name will be written to the final report.

2) __action__ OR __common__: 
   
   - action: Command to perform, examples: 'src/test/system_tests/test_files_spread.js' or 'gulp mocha'
   - common: Run a common functionality the framework provides, example: 'restore_db_defaults'
   
3) __blocking__: If set to true, failure in this step would stop the entire chain

4) __params__: If the action requires parameters, supply an array of parameters. These parameters are chained according to order when the command is executed.

   Each param can be one of two types:
   - arg for a static param, its value provided inline, for example _arg: '5'_
   - input_arg for a dynamic value param, its value provided to the runner as argv when its being run, for example _input_arg: 'ip'_ would result in evaluating the value for the --ip parameter sent for the runner execution (node runner.js --ip 127.0.0.1)

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

```node runner.js --upgrade_pack /tmp/pack.tar.gz`

This step, called "Upgrading to new version" will be executed with the following command:
_node src/test/system_tests/sanity_build_test.js --upgrade_pack /tmp/pack.tar.gz --target_ip 127.0.0.1_

If this step would fail, the runner will not continue to the next step.


###Future Thoughts
Not implemented yet, need to think and see if the following is needed
- Skip to a certain point in flow.js
- Stop at a certain point in flow.js
- Get a different flow.js as input to runner

Not exactly framework related, but get coverage for S3 and Agent code.

'use strict';
var _ = require('lodash');
var fs = require('fs');
var argv = require('minimist')(process.argv);
var istanbul = require('istanbul');

require('dotenv').load();

var promise_utils = require('../../util/promise_utils');
var P = require('../../util/promise');
var ops = require('../system_tests/basic_server_ops');
var api = require('../../api');

var COVERAGE_DIR = '/tmp/cov';
var REPORT_PATH = COVERAGE_DIR + '/regression_report.log';

function TestRunner(argv) {
    this._version = argv.GIT_VERSION;
    this._argv = argv;
    this._error = false;
}

/**************************
 *   Common Functionality
 **************************/
TestRunner.prototype.restore_db_defaults = function() {
    return promise_utils.promised_exec(
            'mongo nbcore /root/node_modules/noobaa-core/src/test/system_tests/mongodb_defaults.js')
        .fail(function(err) {
            console.warn('failed on mongodb_defaults');
            throw new Error('Failed pn mongodb reset');
        });
};

/**************************
 *   Flow Control
 **************************/

TestRunner.prototype.init_run = function() {
    var self = this;
    //Clean previous run results
    console.log('Clearing previous test run results');
    if (!fs.existsSync(COVERAGE_DIR)) {
        fs.mkdirSync(COVERAGE_DIR);
    }

    self._rpc = api.new_rpc();
    self._client = self._rpc.new_client();
    self._bg_client = self._rpc.new_client({
        domain: 'bg'
    });

    return P.fcall(function() {
            var auth_params = {
                email: 'demo@noobaa.com',
                password: 'DeMo',
                system: 'demo'
            };
            return self._client.create_auth_token(auth_params);
        })
        .then(function() {
            return promise_utils.promised_exec('rm -rf ' + COVERAGE_DIR + '/*');
        })
        .fail(function(err) {
            console.error('Failed cleaning ', COVERAGE_DIR, 'from previous run results', err);
            throw new Error('Failed cleaning dir');
        })
        .then(function() {
            return promise_utils.promised_exec('rm -rf /root/node_modules/noobaa-core/coverage/*');
        })
        .fail(function(err) {
            console.error('Failed cleaning istanbul data from previous run results', err);
            throw new Error('Failed cleaning istanbul data');
        })
        .then(function() {
            //set TESTRUN=true in .env
            console.log('Setting TESTRUN');
            return promise_utils.promised_exec("sed -i 's/TESTRUN=false/TESTRUN=true/' /root/node_modules/noobaa-core/.env");
        })
        .fail(function(err) {
            console.error('Failed setting TESTRUN=true in .env', err);
            throw new Error('Failed setting TESTRUN=true in .env');
        })
        .then(function() {
            //Restart services to hook require instanbul
            return self._restart_services();
        })
        .delay(15000)
        .then(function() {
            fs.appendFileSync(REPORT_PATH, 'Init Test Run for version ' + self._version + '\n');
        });
};

TestRunner.prototype.complete_run = function() {
    //Take coverage output and report and pack them
    var self = this;
    var dst = '/tmp/res_' + this._version + '.tgz';
    return this._write_coverage()
        .fail(function(err) {
            console.error('Failed writing coverage for test runs', err);
            throw new Error('Failed writing coverage for test runs');
        })
        .then(function() {
            return promise_utils.promised_exec('tar --warning=no-file-changed -zcvf ' + dst + ' ' + COVERAGE_DIR + '/*');
        })
        .fail(function(err) {
            console.error('Failed archiving test runs', err);
            throw new Error('Failed archiving test runs');
        })
        .then(function() {
            console.log('Disabling TESTRUN');
            return promise_utils.promised_exec("sed -i 's/TESTRUN=true/TESTRUN=false/' /root/node_modules/noobaa-core/.env");
        })
        .fail(function(err) {
            console.error('Failed setting TESTRUN=false in .env', err);
            throw new Error('Failed setting TESTRUN=false in .env');
        })
        .then(function() {
            return self._restart_services();
        })
        .delay(15000)
        .then(function() {
            console.log('Uploading results file');
            //Save package on current NooBaa system
            return ops.upload_file('127.0.0.1', dst, 'files', 'report_' + self._version + '.tgz');
        });
};

TestRunner.prototype.run_tests = function() {
    var self = this;

    var steps = require(process.cwd() + '/src/test/framework/flow.js');
    return P.each(steps, function(current_step) {
            return P.when(self._print_curent_step(current_step))
                .then(function(step_res) {
                    return P.when(self._run_current_step(current_step, step_res));
                })
                .then(function(step_res) {
                    fs.appendFileSync(REPORT_PATH, step_res + '\n');
                });
        })
        .then(function() {
            fs.appendFileSync(REPORT_PATH, 'All steps done\n');
            return;
        })
        .fail(function(error) {
            fs.appendFileSync(REPORT_PATH, 'Stopping tests\n', error);
            return;
        });
};

TestRunner.prototype._print_curent_step = function(current_step) {
    var step_res;
    var title;
    return P.fcall(function() {
        if (_.startsWith(current_step.action, 'TestRunner.utils')) {
            title = 'Performing ' + current_step.name + ' (' + current_step.action + ')';
            step_res = current_step.name;
        } else if (current_step.name) {
            title = 'Running ' + current_step.name;
            step_res = current_step.name;
        } else {
            title = 'Running Unamed ' + current_step.action;
            step_res = current_step.action;
        }
        fs.appendFileSync(REPORT_PATH, title + '\n');
        return step_res;
    });
};

TestRunner.prototype._run_current_step = function(current_step, step_res) {
    var self = this;
    if (!current_step.action && !current_step.common) {
        step_res = '        No Action Defined!!!';
        return;
    } else {
        if (current_step.common) {
            return P.invoke(self, current_step.common)
                .then(function() {
                    return step_res;
                });
        } else {
            return self._run_action(current_step, step_res);
        }
    }
};

TestRunner.prototype._run_action = function(current_step, step_res) {
    var self = this;
    var ts = new Date();
    //Build execution context from action and arguments
    var command = current_step.action;
    if (current_step.params && current_step.params.length > 0) {
        _.each(current_step.params, function(p) {
            if (p.arg) {
                command += ' ' + p.arg;
            } else if (p.input_arg) {
                if (self._argv[p.input_arg]) {
                    command += ' ' + self._argv[p.input_arg];
                } else {
                    fs.appendFileSync(REPORT_PATH, 'No argument recieved for ' + p.input_args + '\n');
                }
            }
        });
    }

    return promise_utils.promised_exec(command)
        .then(function(res) {
            step_res = '        ' + step_res + ' - Successeful ( took ' +
                ((new Date() - ts) / 1000) + 's )';
            return step_res;
        })
        .fail(function(res) {
            self._error = true;
            if (current_step.blocking) {
                fs.appendFileSync(REPORT_PATH, step_res + ' ' + res + '\n');
                throw new Error('Blocking test failed');
            } else {
                step_res = '        ' + step_res + ' - Failed with \n' +
                    '------------------------------\n' +
                    res +
                    '------------------------------   ' +
                    '( took ' + ((new Date() - ts) / 1000) + 's )';
            }
            return step_res;
        });
};

TestRunner.prototype._write_coverage = function() {
    var self = this;
    var collector = new istanbul.Collector();
    var reporter = new istanbul.Reporter(null, COVERAGE_DIR + '/istanbul');
    //Get all collectors data
    return this._bg_client.redirector.publish_to_cluster({
            method_api: 'debug_api',
            method_name: 'get_istanbul_collector',
            target: ''
        }, {
            auth_token: self._client.options.auth_token,
        })
        .then(function(res) {
            //Add all recieved data to the collector
            _.each(res.aggregated, function(r) {
                if (r.data) {
                    var to_add = r.data;
                    collector.add(JSON.parse(to_add));
                } else {
                    console.warn('r.data is undefined');
                }
            });
            //Add unit test coverage data
            collector.add(JSON.parse(fs.readFileSync(COVERAGE_DIR + '/mocha/coverage-final.json', 'utf8')));
            //Generate the report
            reporter.add('lcov');
            reporter.write(collector, true /*sync*/ );
        })
        .fail(function(err) {
            console.warn('Error on write with', err, err.stack);
            throw err;
        });
};

TestRunner.prototype._restart_services = function() {
    console.log('Restarting services');
    return promise_utils.promised_exec('supervisorctl stop all')
        .delay(15000)
        .then(function() {
            console.warn('Shutting down supervisorctl');
            return promise_utils.promised_exec('supervisorctl shutdown');
        })
        .delay(15000)
        .then(function() {
            return promise_utils.promised_exec('/usr/bin/supervisord');
        });
};

module.exports = TestRunner;

function main() {
    if (!argv.GIT_VERSION) {
        console.error('Must supply git version (--GIT_VERSION)');
        process.exit(1);
    }
    var run = new TestRunner(argv);
    return P.when(run.init_run())
        .fail(function(error) {
            console.error('Init run failed, stopping tests', error);
            process.exit(2);
        })
        .then(function() {
            console.warn('Running tests');
            return run.run_tests();
        })
        .fail(function(error) {
            console.error('run tests failed', error);
            process.exit(3);
        })
        .then(function() {
            console.warn('Finalizing run results');
            return run.complete_run();
        })
        .fail(function(error) {
            console.error('Complete run failed', error);
            process.exit(4);
        })
        .then(function() {
            process.exit(0);
        });
}

if (require.main === module) {
    main();
}

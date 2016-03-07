'use strict';
var _ = require('lodash');
var fs = require('fs');
var argv = require('minimist')(process.argv);
var promise_utils = require('../../util/promise_utils');
var P = require('../../util/promise');
var ops = require('../system_tests/basic_server_ops');

//var COVERAGE_DIR = '/root/noobaa-core/coverage';
var COVERAGE_DIR = '/tmp';
var REPORT_PATH = COVERAGE_DIR + '/regression_report.log';

function TestRunner(version, argv) {
    this._version = version;
    this._argv = argv;
    this._error = false;
}

TestRunner.prototype.init_run = function() {
    var self = this;
    //Clean previous run results
    console.log('Clearing previous test run results');
    return promise_utils.promised_exec('rm -rf /root/node_modules/noobaa-core/coverage/*')
        .fail(function(err) {
            console.error('Failed cleaning ', COVERAGE_DIR, 'from previous run results', err);
            throw new Error('Failed cleaning dir');
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
            console.log('Restarting services');
            return promise_utils.promised_exec('supervisorctl restart webserver bg_workers');
        })
        .delay(15000)
        .then(function() {
            fs.appendFileSync(REPORT_PATH, 'Init Test Run for version ' + self._version + '\n');
        });
};

TestRunner.prototype.complete_run = function() {
    //Take coverage output and report and pack them
    var dst = '/tmp/res_' + this._version + '.tgz';
    return promise_utils.promised_exec('tar --warning=no-file-changed -zcvf ' + dst + ' ' + COVERAGE_DIR + '/*')
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
            console.log('Restarting services');
            //Restart services to remove hook require instanbul
            return promise_utils.promised_exec('supervisorctl restart webserver bg_workers');
        })
        .delay(15000)
        .then(function() {
            console.log('Uploading results file');
            //Save package on current NooBaa system
            return ops.upload_file('127.0.0.1', dst);
        });
};

TestRunner.prototype.run_tests = function() {
    var self = this;
    console.warn('NBNB:: starting tests', process.cwd() + '/src/test/framework/flow.json');
    return P.nfcall(fs.readFile, process.cwd() + '/src/test/framework/flow.json') //TODO:: get as arg for execution
        .then(function(data) {
            var steps = JSON.parse(data);
            return P.each(steps.steps, function(current_step) {
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
        });
};

TestRunner.prototype._print_curent_step = function(current_step) {
    var step_res;
    var title;
    console.warn('NBNB:: _print_curent_step');
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
        console.warn('NBNB:: _print_curent_step title', title);
        return step_res;
    });
};

TestRunner.prototype._run_current_step = function(current_step, step_res) {
    var self = this;
    console.warn('NBNB:: _run_current_step');
    if (!current_step.action && !current_step.common) {
        step_res = '        No Action Defined!!!';
        return;
    } else {
        if (current_step.common) {
            console.warn('NBNB:: performing ', current_step.common);
            return self.utils[current_step.common]
                .then(function() {
                    return step_res;
                });
        } else {
            console.warn('NBNB:: _run_action ', current_step.action);
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

    console.warn('NBNB:: running ', command);
    return promise_utils.promised_exec(command)
        .then(function(res) {
            step_res = '        ' + step_res + ' - Successeful ( took ' +
                (new Date() - ts) + 's )';
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
                    '( took ' + (new Date() - ts) + 's )';
            }
            return step_res;
        });
};

TestRunner.prototype.restore_db_defaults = function() {
    return promise_utils.promised_exec(
        'mongo nbcore /root/node_modules/noobaa-core/src/test/system_tests/mongodb_defaults.js');
};

//Common steps such as restore DB to defaults etc.
TestRunner.utils = {
    restore_db_defaults: TestRunner.restore_db_defaults,
};

module.exports = TestRunner;

function main() {
    var run = new TestRunner(5, argv);
    return P.when(run.init_run())
        .fail(function(error) {
            console.error('Init run failed, stopping tests', error);
            process.exit(1);
        })
        .then(function() {
            return run.run_tests(run);
        })
        .fail(function(error) {
            console.error('run tests failed', error);
            process.exit(2);
        })
        .then(function() {
            return run.complete_run();
        })
        .fail(function(error) {
            console.error('Complete run failed', error);
            process.exit(3);
        });
}

if (require.main === module) {
    main();
}

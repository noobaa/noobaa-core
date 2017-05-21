/* Copyright (C) 2016 NooBaa */
'use strict';

require('../../util/dotenv').load();

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv);
const request = require('request');
const istanbul = require('istanbul');

const P = require('../../util/promise');
const api = require('../../api');
const dbg = require('../../util/debug_module')(__filename);
const ops = require('../system_tests/basic_server_ops');
const fs_utils = require('../../util/fs_utils');
const promise_utils = require('../../util/promise_utils');

const COVERAGE_DIR = './report/cov';
const REPORT_PATH = COVERAGE_DIR + '/regression_report.log';

function TestRunner(args) {
    this._version = args.GIT_VERSION;
    this._argv = args;
    this._error = false;
    if (args.FLOW_FILE) {
        this._steps = require(args.FLOW_FILE); // eslint-disable-line global-require
    } else {
        this._steps = require(process.cwd() + '/src/test/framework/flow.js'); // eslint-disable-line global-require
    }
}

/**************************
 *   Common Functionality
 **************************/
TestRunner.prototype.wait_for_server_to_start = function(max_seconds_to_wait, port) {
    var isNotListening = true;
    var MAX_RETRIES = max_seconds_to_wait;
    var wait_counter = 1;
    //wait up to 10 seconds
    console.log('waiting for server to start (1)');

    return promise_utils.pwhile(
            function() {
                return isNotListening;
            },
            function() {
                return P.ninvoke(request, 'get', {
                        url: 'http://127.0.0.1:' + port,
                        rejectUnauthorized: false,
                    })
                    .then(function() {
                        console.log('server started after ' + wait_counter + ' seconds');
                        isNotListening = false;
                    })
                    .catch(function(err) {
                        console.log('waiting for server to start(2)');
                        wait_counter += 1;
                        if (wait_counter >= MAX_RETRIES) {
                            console.Error('Too many retries after restart server', err);
                            throw new Error('Too many retries');
                        }
                        return P.delay(1000);
                    });
                //one more delay for reconnection of other processes
            }).delay(2000)
        .then(function() {
            return;
        });
};

TestRunner.prototype.restore_db_defaults = function() {
    var self = this;

    return promise_utils.exec(
            'mongo nbcore /root/node_modules/noobaa-core/src/test/system_tests/mongodb_defaults.js')
        .catch(function(err) {
            console.warn('failed on mongodb_defaults', err);
            throw new Error('Failed pn mongodb reset');
        })
        .then(function() {
            return promise_utils.exec('supervisorctl restart webserver bg_workers s3rver hosted_agents');
        })
        .then(function() {
            return self.wait_for_server_to_start(30, 8080);
        })
        .then(function() {
            return self.wait_for_server_to_start(30, 80);
        })
        .delay(5000) //Workaround for agents sending HBs and re-registering to the server
        .catch(function(err) {
            console.log('Failed restarting webserver', err);
            throw new Error('Failed restarting webserver');
        });
};

TestRunner.prototype.clean_server_for_run = function() {
    const logs_regexp = /noobaa\.log\...\.gz/;
    const logs_path = '/var/log/';
    return P.resolve(fs.readdirAsync(logs_path))
        .then(files => {
            const num_files = files.length;
            let i = 0;
            return promise_utils.pwhile(
                function() {
                    return i < num_files;
                },
                function() {
                    i += 1;
                    if (logs_regexp.test(files[i - 1])) {
                        return fs.unlinkAsync(path.join(logs_path, files[i - 1]));
                    }
                    return P.resolve();
                }
            );
        });
};

/**************************
 *   Flow Control
 **************************/

TestRunner.prototype.init_run = function() {
    var self = this;
    self._rpc = api.new_rpc();
    self._client = self._rpc.new_client();

    //Clean previous run results
    console.log('Clearing previous test run results');

    return P.resolve()
        .then(() => fs_utils.create_fresh_path(COVERAGE_DIR)
            .catch(function(err) {
                console.error('Failed cleaning ', COVERAGE_DIR, 'from previous run results', err);
                throw new Error('Failed cleaning dir');
            }))
        .then(() => promise_utils.exec('rm -rf /root/node_modules/noobaa-core/coverage/*')
            .catch(function(err) {
                console.error('Failed cleaning istanbul data from previous run results', err);
                throw new Error('Failed cleaning istanbul data');
            }))
        .then(() => self._client.create_auth_token({
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        }))
        //Restart services to hook require instanbul
        .then(() => self._restart_services(true))
        .then(function() {
            fs.appendFileSync(REPORT_PATH, 'Init Test Run for version ' + self._version + '\n');
        });
};

TestRunner.prototype.complete_run = function() {
    //Take coverage output and report and pack them
    var self = this;
    var dst = '/tmp/res_' + this._version + '.tgz';

    return this._write_coverage()
        .catch(function(err) {
            console.error('Failed writing coverage for test runs', err);
            throw new Error('Failed writing coverage for test runs');
        })
        .then(function() {
            return promise_utils.exec('tar --warning=no-file-changed -zcvf ' + dst + ' ' + COVERAGE_DIR + '/*');
        })
        .catch(function(err) {
            console.error('Failed archiving test runs', err);
            throw new Error('Failed archiving test runs');
        })
        .then(function() {
            return self._restart_services(false);
        })
        .then(function() {
            return self.wait_for_server_to_start(30, 80);
        })
        .then(function() {
            return self.wait_for_server_to_start(30, 8080);
        })
        .then(function() {
            console.log('Uploading results file');
            //Save package on current NooBaa system
            return ops.upload_file('127.0.0.1', dst, 'first-bucket', 'report_' + self._version + '.tgz');
        })
        .catch(function(err) {
            console.log('Failed restarting webserver', err);
            throw new Error('Failed restarting webserver');
        });
};

TestRunner.prototype.run_tests = function() {
    var self = this;

    return P.each(self._steps, function(current_step) {
            return P.resolve(self._print_curent_step(current_step))
                .then(function(step_res) {
                    return P.resolve(self._run_current_step(current_step, step_res));
                })
                .then(function(step_res) {
                    fs.appendFileSync(REPORT_PATH, step_res + '\n');
                    return;
                })
                .catch(function(error) {
                    fs.appendFileSync(REPORT_PATH, 'Stopping tests with error ' + error + ' ' + error.stace + ' ' + error.message);
                    throw new Error(error);
                });
        })
        .then(function() {
            console.warn('All steps done');
            fs.appendFileSync(REPORT_PATH, 'All steps done\n');
            return;
        })
        .catch(function(error) {
            fs.appendFileSync(REPORT_PATH, 'Stopping tests with error\n' + error);
            throw new Error(error);
        });
};

TestRunner.prototype.print_conclusion = function() {
    console.log(fs.readFileSync('./report/cov/regression_report.log').toString());
};

TestRunner.prototype._print_curent_step = function(current_step) {
    var step_res;
    var title;
    return P.fcall(function() {
        if (current_step.common) {
            title = 'Performing ' + current_step.name;
            step_res = current_step.name;
        } else if (current_step.action) {
            title = 'Running Action ' + current_step.name;
            step_res = current_step.name;
        } else if (current_step.lib_test) {
            title = 'Running Library Test ' + current_step.name;
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
    if (!current_step.action &&
        !current_step.common &&
        !current_step.lib_test) {
        step_res = '        No Action Defined!!!';
        return;
    }
    console.warn('---------------------------------  ' + step_res + '  ---------------------------------');
    if (current_step.common) {
        var ts = new Date();
        return P.resolve()
            .then(() => self[current_step.common].apply(self))
            .then(function() {
                return step_res + ' - Successeful common step ( took ' +
                    ((new Date() - ts) / 1000) + 's )';
                //return step_res;
            })
            .catch(function(err) {
                console.warn('Failure while running ' + step_res + ' with error ' + err);
                throw new Error(err);
            });
    } else if (current_step.action) {
        return self._run_action(current_step, step_res);
    } else if (current_step.lib_test) {
        return self._run_lib_test(current_step, step_res);
    } else {
        throw new Error('Undefined step');
    }

};

TestRunner.prototype._run_action = function(current_step, step_res) {
    var self = this;
    var ts = new Date();
    //Build execution context from action and arguments
    var command = current_step.action;
    var args = _.compact(_.map(current_step.params, function(p) {
        if (p.arg) {
            return p.arg;
        } else if (p.input_arg) {
            if (self._argv[p.input_arg]) {
                return self._argv[p.input_arg];
            } else {
                fs.appendFileSync(REPORT_PATH, 'No argument recieved for ' + p.input_args + '\n');
            }
        }
    }));
    var options = _.pick(current_step, 'env');

    return promise_utils.spawn(command, args, options)
        .then(function(res) {
            step_res = '        ' + step_res + ' - Successeful running action  ( took ' +
                ((new Date() - ts) / 1000) + 's )';
            console.warn('---------------------------------  ' + step_res + '  ---------------------------------');
            return step_res;
        })
        .catch(function(res) {
            self._error = true;
            if (current_step.blocking) {
                fs.appendFileSync(REPORT_PATH, step_res + ' ' + res + '\n');
                throw new Error('Blocking action failed');
            } else {
                step_res = '        ' + step_res + ' - Failed with \n' +
                    '------------------------------\n' +
                    res +
                    '------------------------------   ' +
                    '( took ' + ((new Date() - ts) / 1000) + 's )';
            }
            console.warn('Failed action with', res);
            return step_res;
        });
};

TestRunner.prototype._run_lib_test = function(current_step, step_res) {
    var self = this;
    var ts = new Date();
    // Used in order to log inside a file instead of console prints
    dbg.set_log_to_file(process.cwd() + COVERAGE_DIR.substring(1) + '/' + path.parse(current_step.lib_test).name);
    var test = require(process.cwd() + current_step.lib_test); // eslint-disable-line global-require
    return P.resolve(test.run_test())
        .then(function(res) {
            dbg.set_log_to_file();
            step_res = '        ' + step_res + ' - Successeful ( took ' +
                ((new Date() - ts) / 1000) + 's )';
            console.warn('---------------------------------  ' + step_res + '  ---------------------------------');
            return step_res;
        })
        .catch(function(res) {
            self._error = true;
            if (current_step.blocking) {
                fs.appendFileSync(REPORT_PATH, step_res + ' ' + res + '\n');
                throw new Error('Blocking libtest failed');
            } else {
                step_res = '        ' + step_res + ' - Failed with \n' +
                    '------------------------------\n' +
                    res +
                    '------------------------------   ' +
                    '( took ' + ((new Date() - ts) / 1000) + 's )';
            }
            console.warn('Failed lib test with', res);
            return step_res;
        });
};


TestRunner.prototype._write_coverage = function() {
    var self = this;
    var collector = new istanbul.Collector();
    var reporter = new istanbul.Reporter(null, COVERAGE_DIR + '/istanbul');
    //Get all collectors data
    return this._client.redirector.publish_to_cluster({
            method_api: 'debug_api',
            method_name: 'get_istanbul_collector',
            target: ''
        }, {
            auth_token: self._client.options.auth_token,
        })
        .then(function(res) {
            //Add all recieved data to the collector
            _.each(res.redirect_reply.aggregated, function(r) {
                if (r.data) {
                    var to_add = r.data;
                    collector.add(JSON.parse(to_add));
                } else {
                    console.warn('r.data is undefined, skipping');
                }
            });

            //Add unit test coverage data if exists (on failure of unit test, does not exist)
            if (fs.existsSync(COVERAGE_DIR + '/mocha/coverage-final.json')) {
                console.warn('No unit test coverage info, skipping');
                collector.add(JSON.parse(fs.readFileSync(COVERAGE_DIR + '/mocha/coverage-final.json', 'utf8')));
            }

            //Generate the report
            reporter.add('lcov');
            return P.fcall(function() {
                    const REPORTER_SYNC = true;
                    return reporter.write(collector, REPORTER_SYNC, function() {
                        console.warn('done reporter.write');
                    });
                })
                .catch(function(err) {
                    console.warn('Error on write with', err, err.stack);
                    throw err;
                });
        })
        .catch(function(err) {
            console.warn('Error on _write_coverage', err, err.stack);
            throw err;
        });
};

TestRunner.prototype._restart_services = function(testrun) {
    console.log('Restarting services with TESTRUN arg to', testrun);
    var command;
    if (testrun) { //Add --TESTRUN to the required services
        command = "sed -i 's/\\(.*web_server.js\\)/\\1 --TESTRUN/' /etc/noobaa_supervisor.conf ";
        command += " ; sed -i 's/\\(.*bg_workers.js\\)/\\1 --TESTRUN/' /etc/noobaa_supervisor.conf ";
    } else { //Remove --TESTRUN from the required services
        command = "sed -i 's/\\(.*web_server.js\\).*--TESTRUN/\\1/' /etc/noobaa_supervisor.conf ";
        command += " ; sed -i 's/\\(.*bg_workers.js\\).*--TESTRUN/\\1/' /etc/noobaa_supervisor.conf ";
    }

    return promise_utils.exec(command)
        .then(function() {
            return promise_utils.exec('supervisorctl reload');
        })
        .delay(5000)
        .then(function() {
            return promise_utils.exec('supervisorctl restart webserver bg_workers');
        })
        .delay(5000);

};

module.exports = TestRunner;

function main() {
    if (!argv.GIT_VERSION) {
        console.error('Must supply git version (--GIT_VERSION)');
        process.exit(1);
    }
    var run = new TestRunner(argv);
    return P.resolve(run.init_run())
        .catch(function(error) {
            console.error('Init run failed, stopping tests', error);
            run._restart_services(false);
            process.exit(2);
        })
        .then(function() {
            console.warn('Running tests');
            return run.run_tests();
        })
        .catch(function(error) {
            console.error('run tests failed', error);
            run._restart_services(false);
            process.exit(3);
        })
        .then(function() {
            console.warn('Finalizing run results');
            return run.complete_run();
        })
        .catch(function(error) {
            console.error('Complete run failed', error);
            run._restart_services(false);
            process.exit(4);
        })
        .then(function() {
            run.print_conclusion();
            if (run._error) {
                run._restart_services(false);
                process.exit(1);
            } else {
                process.exit(0);
            }
        });
}

if (require.main === module) {
    main();
}

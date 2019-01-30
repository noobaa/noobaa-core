/* Copyright (C) 2016 NooBaa */
'use strict';

require('../../util/dotenv').load();

const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv);
const request = require('request');

const P = require('../../util/promise');
const api = require('../../api');
const dbg = require('../../util/debug_module')(__filename);
const ops = require('../utils/basic_server_ops');
const fs_utils = require('../../util/fs_utils');
const promise_utils = require('../../util/promise_utils');
const { CoverageReport } = require('../../util/coverage_utils');

const COVERAGE_DIR = './report/cov';
const REPORT_PATH = COVERAGE_DIR + '/regression_report.log';
const DEFAULT_TEST_TIMEOUT = 20 * 60 * 1000; // 20 minutes timeout for a test

class TestRunner {
    constructor(args) {
        this._version = args.GIT_VERSION;
        this.server_ip = args.server_ip || '127.0.0.1';
        this._argv = args;
        this._error = false;
        this.tests_results = [];
        if (args.FLOW_FILE) {
            this._steps = require(args.FLOW_FILE); // eslint-disable-line global-require
        } else {
            this._steps = require(process.cwd() + '/src/test/framework/flow.js'); // eslint-disable-line global-require
        }
    }

    /**************************
     *   Common Functionality
     **************************/
    wait_for_server_to_start(max_seconds_to_wait, port) {
        const self = this;
        var isNotListening = true;
        var MAX_RETRIES = max_seconds_to_wait;
        var wait_counter = 1;
        //wait up to 10 seconds
        console.log('waiting for server to start (1)');
        return promise_utils.pwhile(function() {
                return isNotListening;
            }, function() {
                return P.ninvoke(request, 'get', {
                        url: `http://${self.server_ip}:` + port,
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
                            console.error('Too many retries after restart server', err);
                            throw new Error('Too many retries');
                        }
                        return P.delay(1000);
                    });
                //one more delay for reconnection of other processes
            })
            .delay(2000)
            .return();
    }

    restore_db_defaults() {
        var self = this;
        return promise_utils.exec('mongo nbcore /root/node_modules/noobaa-core/src/test/system_tests/mongodb_defaults.js')
            .catch(function(err) {
                console.log('failed on mongodb_defaults', err);
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
    }

    clean_server_for_run() {
        if (os.type() === 'Darwin') return;
        const logs_regexp = /noobaa\.log\...\.gz/;
        const logs_path = '/log/';
        return P.resolve(fs.readdirAsync(logs_path))
            .then(files => {
                const num_files = files.length;
                let i = 0;
                return promise_utils.pwhile(function() {
                    return i < num_files;
                }, function() {
                    i += 1;
                    if (logs_regexp.test(files[i - 1])) {
                        return fs.unlinkAsync(path.join(logs_path, files[i - 1]));
                    }
                    return P.resolve();
                });
            });
    }

    /**************************
     *   Flow Control
     **************************/
    init_run() {
        var self = this;
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
            .then(() => self._restart_services(false)) // TODO: restore to 'true' to run coverage
            .then(function() {
                fs.appendFileSync(REPORT_PATH, 'Init Test Run for version ' + self._version + '\n');
            });
    }

    complete_run() {
        //Take coverage output and report and pack them
        var self = this;
        var dst = '/tmp/res_' + this._version + '.tgz';
        // return this._write_coverage() // TODO: restore _write_coverage
        return P.resolve()
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
                return ops.upload_file(self.server_ip, dst, 'first.bucket', 'report_' + self._version + '.tgz');
            })
            .catch(function(err) {
                console.log('Failed restarting webserver', err);
                throw new Error('Failed restarting webserver');
            });
    }

    run_tests() {
        var self = this;
        return P.each(self._steps, function(current_step) {
                return P.resolve(self._print_curent_step(current_step))
                    .then(function(step_res) {
                        return P.resolve(self._run_current_step(current_step, step_res));
                    })
                    .then(function(step_res) {
                        fs.appendFileSync(REPORT_PATH, step_res + '\n');

                    })
                    .catch(function(error) {
                        fs.appendFileSync(REPORT_PATH, 'Stopping tests with error ' + error + ' ' + error.stace + ' ' + error.message);
                        throw new Error(error);
                    });
            })
            .then(function() {
                console.log('All steps done');
                fs.appendFileSync(REPORT_PATH, 'All steps done\n');

            })
            .catch(function(error) {
                fs.appendFileSync(REPORT_PATH, 'Stopping tests with error\n' + error);
                throw new Error(error);
            });
    }

    print_conclusion() {
        for (const res of this.tests_results) {
            if (res.success) {
                console.log(`===PASSED=== ${res.name} passed`);
            } else if (res.ignored) {
                console.warn(`===FAILED-IGNORED=== ${res.name} failed - Result ignored`);
            } else {
                console.error(`===FAILED=== ${res.name} failed!`);
            }
        }
    }

    _print_curent_step(current_step) {
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
    }

    _run_current_step(current_step, step_res) {
        var self = this;
        if (!current_step.action &&
            !current_step.common &&
            !current_step.lib_test) {
            step_res = '        No Action Defined!!!';
            return;
        }
        if (current_step.common) {
            console.log('running', step_res);
            dbg.set_log_to_file(path.join(process.cwd(), COVERAGE_DIR, current_step.name.replace(/ /g, '_')) + '.log');
            var ts = new Date();
            return P.resolve()
                .then(() => self[current_step.common].apply(self))
                .timeout(current_step.timeout || DEFAULT_TEST_TIMEOUT)
                .finally(() => dbg.set_log_to_file())
                .then(function() {
                    return step_res + ' - Successful common step ( took ' +
                        ((new Date() - ts) / 1000) + 's )';
                    //return step_res;
                })
                .catch(function(err) {
                    console.error('Failure while running ' + step_res + ' with error ' + err);
                    throw new Error(err);
                });
        } else {
            console.log('---------------------------------  ' + step_res + '  ---------------------------------');
            if (current_step.action) {
                return self._run_action(current_step, step_res);
            } else if (current_step.lib_test) {
                return self._run_lib_test(current_step, step_res);
            } else {
                throw new Error('Undefined step');
            }
        }
    }

    _run_action(current_step, step_res) {
        var ts = new Date();
        //Build execution context from action and arguments
        var command = current_step.action;
        var args = _.compact(_.map(current_step.params, p => {
            if (p.arg) {
                return p.arg;
            } else if (p.input_arg) {
                if (this._argv[p.input_arg]) {
                    return this._argv[p.input_arg];
                } else {
                    fs.appendFileSync(REPORT_PATH, 'No argument recieved for ' + p.input_args + '\n');
                }
            }
        }));
        var options = _.pick(current_step, 'env');
        return promise_utils.spawn(command, args, options, false, false, current_step.timeout || DEFAULT_TEST_TIMEOUT)
            .then(res => {
                this.tests_results.push({ name: current_step.name, success: true });
                step_res = '        ' + step_res + ' - Successful running action  ( took ' +
                    ((new Date() - ts) / 1000) + 's )';
                console.log(step_res);
                return step_res;
            })
            .catch(err => {
                const result = { name: current_step.name, success: false, ignored: true };
                if (!current_step.ignore_failure) {
                    this._error = true;
                    result.ignored = false;
                }
                this.tests_results.push(result);
                if (current_step.blocking) {
                    fs.appendFileSync(REPORT_PATH, step_res + ' ' + err + '\n');
                    throw new Error('Blocking action failed');
                } else {
                    step_res = '------------------------------\n' +
                        '        ' + step_res + ' - Failed with \n' +
                        err +
                        '\n------------------------------   ' +
                        '( took ' + ((new Date() - ts) / 1000) + 's )';
                }
                console.error(step_res, 'Failed action with', err.message);
                return step_res;
            });
    }

    _run_lib_test(current_step, step_res) {
        var ts = new Date();
        // Used in order to log inside a file instead of console prints
        var test = require(process.cwd() + current_step.lib_test); // eslint-disable-line global-require
        return P.resolve(test.run_test())
            .timeout(current_step.timeout || DEFAULT_TEST_TIMEOUT)
            .then(res => {
                this.tests_results.push({ name: current_step.name, success: true });
                step_res = '        ' + step_res + ' - Successful ( took ' +
                    ((new Date() - ts) / 1000) + 's )';
                console.log(step_res);
                return step_res;
            })
            .catch(res => {
                const result = { name: current_step.name, success: false, ignored: true };
                if (!current_step.ignore_failure) {
                    this._error = true;
                    result.ignored = false;
                }
                this.tests_results.push(result);
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
                console.error('Failed lib test with', res);
                return step_res;
            });
    }

    _write_coverage() {
        const report = new CoverageReport();
        //Get all collectors data
        const rpc = api.new_rpc();
        const client = rpc.new_client();
        return client.create_auth_token({
                email: 'demo@noobaa.com',
                password: 'DeMo1',
                system: 'demo'
            })
            .then(() => client.redirector.publish_to_cluster({
                method_api: 'debug_api',
                method_name: 'get_coverage_data',
                target: ''
            }, {
                auth_token: client.options.auth_token,
            }))
            .then(function(res) {

                // Add all recieved data to the collector
                _.each(res.redirect_reply.aggregated, function(r) {
                    if (r.coverage_data) {
                        report.add_data(r.coverage_data);
                    } else {
                        console.warn('no coverage_data');
                    }
                });

                // Add unit test coverage data if exists (on failure of unit test, does not exist)
                const unit_test_coverage_file = COVERAGE_DIR + '/mocha/coverage-final.json';
                if (fs.existsSync(unit_test_coverage_file)) {
                    const coverage_data = JSON.parse(fs.readFileSync(unit_test_coverage_file, 'utf8'));
                    report.add_data(coverage_data);
                } else {
                    console.warn('No unit test coverage_data');
                }

                report.write({
                    report_dir: COVERAGE_DIR + '/istanbul',
                    report_type: 'lcov',
                });

                console.log('done writing coverage report');
            })
            .catch(function(err) {
                console.warn('Error on _write_coverage', err, err.stack);
                throw err;
            });
    }

    async _restart_services(testrun) {
        if (os.type() === 'Darwin') return;
        console.log('Restarting services with TESTRUN arg to', testrun);
        var command;
        if (testrun) {
            command = "sed -i 's/\\(.*web_server.js\\)/\\1 --TESTRUN/' /data/noobaa_supervisor.conf ";
            command += " ; sed -i 's/\\(.*bg_workers.js\\)/\\1 --TESTRUN/' /data/noobaa_supervisor.conf ";
        } else {
            command = "sed -i 's/\\(.*web_server.js\\).*--TESTRUN/\\1/' /data/noobaa_supervisor.conf ";
            command += " ; sed -i 's/\\(.*bg_workers.js\\).*--TESTRUN/\\1/' /data/noobaa_supervisor.conf ";
        }
        await promise_utils.exec(command);
        let retries = 0;
        const MAX_RETRIES = 3;
        while (retries < MAX_RETRIES) {
            try {
                await promise_utils.exec('supervisorctl update');
                await P.delay(5000);
                await promise_utils.exec('supervisorctl restart webserver bg_workers');
                retries = MAX_RETRIES;
            } catch (err) {
                retries += 1;
                if (retries < MAX_RETRIES) {
                    console.error('failed restarting services. retry..', err);
                    await P.delay(5000);
                } else {
                    console.error(`failed restarting services for ${MAX_RETRIES} retries. aborting`, err);
                    throw err;
                }
            }
        }
        await P.delay(5000);
    }
}


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
            console.log('Running tests');
            return run.run_tests();
        })
        .catch(function(error) {
            console.error('run tests failed', error);
            run._restart_services(false);
            process.exit(3);
        })
        .then(function() {
            console.log('Finalizing run results');
            return run.complete_run();
        })
        .catch(function(error) {
            console.error('Complete run failed', error);
            run._restart_services(false);
            process.exit(4);
        })
        .finally(() => {
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

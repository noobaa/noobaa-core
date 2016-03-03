'use strict';
var _ = require('lodash');
var fs = require('fs');
var promise_utils = require('../../util/promise_utils');
var P = require('../../util/promise');

//var COVERAGE_DIR = '/root/noobaa-core/coverage';
var COVERAGE_DIR = '/tmp';
var REPORT_PATH = COVERAGE_DIR + '/regression_report.log';

function TestRunner(version) {
    this._version = version;
}

TestRunner.prototype.init_run = function() {
    //Clean previous run results
    return promise_utils.promised_exec('rm -rf /root/noobaa-core/coverage/*')
        .fail(function(err) {
            console.error('Failed cleaning ', COVERAGE_DIR, 'from previous run results');
            throw new Error('Failed cleaning dir');
        })
        .then(function() {
            //Retsart all procceses with coverage
        })
        .then(function() {
            fs.appendFileSync(REPORT_PATH, 'Init Test Run for version' + this._version + '\n');
        });
};

TestRunner.prototype.complete_run = function() {
    //Restart services without coverage

    //Take coverage output and report and pack them
    var dst = '/tmp/res_' + this._version + '.tgz';
    return promise_utils.promised_exec('tar --warning=no-file-changed -zcvf ' + dst + ' ' + COVERAGE_DIR + '/*')
        .then(function() {
            //Save package on current NooBaa system
        });
};

TestRunner.prototype.run_tests = function() {
    return P.nfcall(fs.readFile, process.cwd() + '/src/test/framework/flow.json') //TODO:: get as arg for execution
        .then(function(data) {
            var steps = JSON.parse(data);
            var title;
            var step_res;
            var ts;
            P.each(steps.steps, function(current_step) {
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
                    console.warn(title);
                    //Actual run of the action
                    ts = new Date();
                }).
                then(function() {
                        return promise_utils.promised_exec(current_step.action)
                            .then(function(res) {
                                step_res = '        ' + step_res + ' - Successeful ( ' +
                                    (new Date() - ts) + 's )';
                            })
                            .fail(function(res) {
                                step_res = '        ' + step_res + ' - Failed with ' +
                                    res +
                                    '( ' + (new Date() - ts) + 's )';
                            });
                    })
                    .then(function() {
                        fs.appendFileSync(REPORT_PATH, step_res + '\n');
                        console.warn(step_res);
                    });
            });
        });
};

function restore_db_defaults() {
    //TODO:: evgeny script
}

//Common steps such as restore DB to defaults etc.
TestRunner.utils = {
    restore_db_defaults: restore_db_defaults,
};

module.exports = TestRunner;

function main() {
    var run = new TestRunner(5);
    run.run_tests();
}

if (require.main === module) {
    main();
}

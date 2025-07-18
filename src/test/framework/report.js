/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const assert = require('assert');

//const report_schema = require('./report_schema'); //NBNB TODO add schema verification
require('../../util/dotenv').load();

const OMITTED_TEST_CONF = ['server_ip', 'server', 'bucket', 'id', 'location', 'resource', 'storage', 'vnet', 'upgrade_pack', 'access_key', 'secret_key'];

class Reporter {

    static get OMITTED_TEST_CONF() {
        //Common argv/test config parameters which are not relevant and should be omitted
        return OMITTED_TEST_CONF;
    }

    constructor() {
        this._passed = 0;
        this._failed = 0;
        this._paused = false;
        this.host = 'localhost';
        this.port = '38000';
        this._passed_cases = [];
        this._failed_cases = [];
        this._cases_map = [];
    }

    init_reporter({ suite, conf, env, mongo_report, cases, prefix }) {
        this._suite_name = suite;
        this._conf = _.omit(conf, OMITTED_TEST_CONF);
        this._env = env;
        if (mongo_report) {
            this._remote_mongo = true;
            this._mongo_connect_delay = 30 * 1000;
        }
        if (prefix) {
            this._prefix = prefix;
        }
        if (cases) {
            this._cases_map = _.clone(cases.map(c => (this._prefix ? this._prefix + '_' + c : c)));
        }
    }

    add_test_cases(cases) {
        this._cases_map = _.uniq(
            this._cases_map.concat(cases.map(c => (this._prefix ? this._prefix + '_' + c : c))));
    }

    success(step) {
        const updated_step = this._prefix ? this._prefix + '_' + step : step;
        if (_.findIndex(this._cases_map, c => c === updated_step) === -1) {
            assert(false, `Trying to add success for non existent case ${updated_step}`);
        }
        this._passed_cases.push(updated_step);
        console.log(`successful case reported: ${step}`);
    }

    fail(step) {
        const updated_step = this._prefix ? this._prefix + '_' + step : step;
        if (_.findIndex(this._cases_map, c => c === updated_step) === -1) {
            assert(false, `Trying to add failure for non existent case ${updated_step}`);
        }
        this._failed_cases.push(updated_step);
        console.warn(`failed case reported: ${step}`);
    }

    pause() {
        this._paused = true;
    }

    resume() {
        this._paused = false;
    }

    all_tests_passed() {
        return this._failed_cases.length === 0;
    }

    async report() {
        if (!this._paused) {
            console.log(`----- SUITE ${this._suite_name} -----\nconf ${JSON.stringify(this._conf, null, 4)}` + (this._env ? `\n\tenv ${this._env}` : ''));
            if (this._passed_cases.length > 0 || this._failed_cases.length > 0) {
                console.log(`Passed cases: ${JSON.stringify(_.countBy(this._passed_cases), null, 4)}
Failed cases: ${JSON.stringify(_.countBy(this._failed_cases), null, 4)}
Didn't Run: ${JSON.stringify(
                        this._cases_map.filter(c =>
                            !_.includes(this._passed_cases, c) &&
                            !_.includes(this._failed_cases, c)),
                        null, 4)}`);
                await this._send_report();
            }
        }
    }

    _prepare_report_payload() {
        return {
            date: new Date(),
            suite_name: this._suite_name,
            conf: this._conf,
            env: this._env,
            results: {
                passed_cases: _.countBy(this._passed_cases),
                failed_cases: _.countBy(this._failed_cases),
                didnt_run: _.countBy(this._cases_map.filter(c =>
                    !_.includes(this._passed_cases, c) &&
                    !_.includes(this._failed_cases, c)))
            }
        };
    }

    async _send_report() {
        try {
            const payload = this._prepare_report_payload();

            // This is old code that requires more cleanup. For now removed the code that sends the report
            console.log(`payload: ${JSON.stringify(payload)}`);
        } catch (err) {
            console.error('failed sending report', err);
        }
    }

}

module.exports = Reporter;

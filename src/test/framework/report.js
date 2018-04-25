/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const request = require('request');
const P = require('../../util/promise');
require('../../util/dotenv').load();

class Reporter {
    constructor() {
        this._passed = 0;
        this._failed = 0;
        this.host = '127.0.0.1';
        this.port = '38000';
        this._passed_cases = [];
        this._failed_cases = [];
    }

    //TODO: Add the ability to report env
    // currently env is defined as enviroment that is not configured by the test
    init_reporter({ suite, conf, env }) {
        this._suite_name = suite;
        this._conf = conf;
        this._env = env;
    }

    success(step) {
        this._passed_cases.push(step);
    }

    fail(step) {
        this._failed_cases.push(step);
    }

    async print_report() {
        console.log(`suite ${this._suite_name}, conf ${JSON.stringify(this._conf, null, 4)}` + (this._env ? `, env ${this._env}` : ''));
        //TODO send request...
        if (this._passed_cases.length > 0) {
            console.log(`Passed cases: ${JSON.stringify(_.countBy(this._passed_cases), null, 4)}`);
            await this.send_request(_.countBy(this._passed_cases));
        }
        if (this._failed_cases.length > 0) {
            console.log(`failed cases: ${JSON.stringify(_.countBy(this._failed_cases), null, 4)}`);
            await this.send_request(_.countBy(this._failed_cases));
        }
    }

    send_request(req) {
        if (process.env.SEND_REPORT) {
            var options = {
                uri: 'http://' + this.host + ':' + this.port,
                method: 'POST',
                json: req
            };

            return P.fromCallback(callback => request(options, callback))
                .timeout(60 * 1000);
        } else {
            P.resolve()
                .then(() => console.log('skip sending request'));
        }
    }

}

module.exports = Reporter;

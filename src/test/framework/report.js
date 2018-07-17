/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const request = require('request');
const mongodb = require('mongodb');

const P = require('../../util/promise');
//const report_schema = require('./report_schema'); //NBNB TODO add schema verification
require('../../util/dotenv').load();

const REMOTE_MONGO_URL = 'mongodb://reporter:4*pRw3-vZb@ds139841.mlab.com:39841/test_reports';
const REMOTE_MONGO_CONFIG = {
    promiseLibrary: P,
    reconnectTries: -1,
    reconnectInterval: 1000,
    autoReconnect: true,
    bufferMaxEntries: 0,
    keepAlive: 1,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 0,
    ignoreUndefined: true,
};
const OMITTED_TEST_CONF = ['server_ip', 'server', 'bucket', 'id', 'location', 'resource', 'storage', 'vnet', 'upgrade_pack', 'access_key', 'secret_key'];

class Reporter {
    static get REMOTE_MONGO_URL() {
        return REMOTE_MONGO_URL;
    }

    static get REMOTE_MONGO_CONFIG() {
        //see mongo_client for config explanations 
        return REMOTE_MONGO_CONFIG;
    }

    static get OMITTED_TEST_CONF() {
        //Common argv/test config parameters which are not relevant and should be ommited
        return OMITTED_TEST_CONF;
    }

    constructor() {
        this._passed = 0;
        this._failed = 0;
        this.host = '127.0.0.1';
        this.port = '38000';
        this._passed_cases = [];
        this._failed_cases = [];
    }

    init_reporter({ suite, conf, env, mongo_report }) {
        this._suite_name = suite;
        this._conf = _.omit(conf, OMITTED_TEST_CONF);
        this._env = env;
        if (mongo_report) {
            this._remote_mongo = true;
            this._mongo_connect_delay = 30 * 1000;
        }
    }

    success(step) {
        this._passed_cases.push(step);
    }

    fail(step) {
        this._failed_cases.push(step);
    }

    async report() {
        console.log(`----- SUITE ${this._suite_name} -----\nconf ${JSON.stringify(this._conf, null, 4)}` + (this._env ? `\n\tenv ${this._env}` : ''));
        if (this._passed_cases.length > 0 || this._failed_cases.length > 0) {
            console.log(`Passed cases: ${JSON.stringify(_.countBy(this._passed_cases), null, 4)}
Failed cases: ${JSON.stringify(_.countBy(this._failed_cases), null, 4)}`);

            await this._send_report();
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
                failed_cases: _.countBy(this._failed_cases)
            }
        };
    }

    async _connect_to_mongo() {
        let retries = 5;
        while (retries) {
            try {
                this._db = await mongodb.MongoClient.connect(REMOTE_MONGO_URL, REMOTE_MONGO_CONFIG);
                break;
            } catch (err) {
                retries -= 1;
                if (retries) {
                    console.error(`Failed connecting to mongo, will retry in 30s retry`, err);
                    await P.delay(this._mongo_connect_delay);
                } else {
                    throw new Error('Error connecting to remote mongo');
                }
            }
        }

        this._db.on('reconnect', () => {
            console.log('got reconnect on mongo connection');
        });
        this._db.on('close', () => {
            console.warn('got close on mongo connection');
        });
    }

    async _send_report() {
        try {
            const payload = this._prepare_report_payload();
            if (this._remote_mongo) {
                await this._connect_to_mongo();
                await this._db.collection('reports').insert(payload);
                console.info('report sent to remote mongo');
            } else if (process.env.SEND_REPORT) {
                var options = {
                    uri: 'http://' + this.host + ':' + this.port,
                    method: 'POST',
                    json: payload
                };
                await P.fromCallback(callback => request(options, callback))
                    .timeout(60 * 1000);
            } else {
                console.info('skip report send');
                return;
            }
        } catch (err) {
            console.error('failed seding report', err);
        }
    }

}

module.exports = Reporter;

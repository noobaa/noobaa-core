/* Copyright (C) 2016 NooBaa */
'use strict';

const mongodb = require('mongodb');

const P = require('../../util/promise');
const Reporter = require('./report.js');


class ConsolidateReports {
    constructor() {
        this._mongo_connect_delay = 30 * 1000;
        this._date_back_offset_days = 7; //7 Days back
    }

    async _init() {
        let retries = 5;
        while (retries) {
            try {
                this._db = await mongodb.MongoClient.connect(Reporter.REMOTE_MONGO_URL, Reporter.REMOTE_MONGO_CONFIG);
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
    }

    async _fetch_data() {
        let start_date = new Date();
        start_date.setDate(start_date.getDate() - this._date_back_offset_days);
        try {
            const raw_data = await this._db.collection('reports').aggregate([
                { $match: { date: { $gt: start_date } } },
                { $group: { _id: "$suite_name", total_passed: { $sum: '$results.passed_cases' }, total_failes: { $sum: '$results.failed_cases' } } }
            ]).toArray();
            console.log(raw_data);
        } catch (err) {
            console.error('Failed retrieving data from remote mongo', err);
        }
    }

    async prepare_data() {
        await this._init();
        await this._fetch_data();
    }

}

module.exports = ConsolidateReports;

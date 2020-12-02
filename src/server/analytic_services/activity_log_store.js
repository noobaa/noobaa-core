/* Copyright (C) 2016 NooBaa */
'use strict';

const mongodb = require('mongodb');
const _ = require('lodash');

const db_client = require('../../util/db_client');
const P = require('../../util/promise');
const activity_log_schema = require('./activity_log_schema');
const activity_log_indexes = require('./activity_log_indexes');

class ActivityLogStore {

    constructor() {
        this._activitylogs = db_client.instance().define_collection({
            name: 'activitylogs',
            schema: activity_log_schema,
            db_indexes: activity_log_indexes,
        });
    }

    static instance() {
        if (!ActivityLogStore._instance) ActivityLogStore._instance = new ActivityLogStore();
        return ActivityLogStore._instance;
    }

    make_activity_log_id(id_str) {
        return new mongodb.ObjectID(id_str);
    }


    create(activity_log) {
        return P.resolve().then(async () => {
            if (!activity_log._id) {
                activity_log._id = this.make_activity_log_id();
            }
            try {
                this._activitylogs.validate(activity_log);
                await this._activitylogs.insertOne(activity_log);
            } catch (err) {
                db_client.instance().check_duplicate_key_conflict(err, 'audit_log');
            }
            return activity_log;
        });
    }

    read_activity_log(query) {
        const { skip = 0, limit = 100 } = query;
        let selector = this._create_selector(query);
        return P.resolve().then(async () => this._activitylogs.find(selector, { skip, limit, sort: { time: -1 } }));
    }

    _create_selector(query) {
        const { system, till, since, event, read } = query;

        let time;
        if (till) {
            time = { $lt: new Date(till) };
        } else if (since) {
            time = { $gt: new Date(since) };
        }

        let event_regex;
        if (event) {
            event_regex = { $regex: event };
        }

        return _.omitBy({
            time,
            event: event_regex,
            system,
            read,
        }, _.isUndefined);
    }

}


// EXPORTS
exports.ActivityLogStore = ActivityLogStore;

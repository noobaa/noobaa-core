/* Copyright (C) 2016 NooBaa */
'use strict';

const mongodb = require('mongodb');
const _ = require('lodash');

const P = require('../../util/promise');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
const activity_log_schema = require('./activity_log_schema');

class ActivityLogStore {

    constructor() {
        this._activitylogs = mongo_client.instance().define_collection({
            name: 'activitylogs',
            schema: activity_log_schema,
            db_indexes: [{
                fields: {
                    time: 1,
                },
                options: {
                    unique: false,
                }
            }]
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
        if (!activity_log._id) {
            activity_log._id = this.make_activity_log_id();
        }
        return P.resolve()
            .then(() => this._activitylogs.validate(activity_log))
            .then(() => this._activitylogs.col().insertOne(activity_log))
            .catch(err => mongo_utils.check_duplicate_key_conflict(err, 'audit_log'))
            .return(activity_log);
    }

    read_activity_log(query) {
        const { skip = 0, limit = 100 } = query;
        let selector = this._create_selector(query);
        return P.resolve()
            .then(() => this._activitylogs.col().find(selector)
                .skip(skip)
                .limit(limit)
                .sort({ time: -1 })
                .toArray());
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

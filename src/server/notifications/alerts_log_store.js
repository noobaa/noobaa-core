/* Copyright (C) 2016 NooBaa */
'use strict';

const mongo_utils = require('../../util/mongo_utils');
const _ = require('lodash');
const P = require('../../util/promise');
const db_client = require('../../util/db_client');

const alerts_log_schema = require('./alerts_log_schema');

class AlertsLogStore {

    constructor() {
        this._alertslogs = db_client.instance().define_collection({
            name: 'alertslogs',
            schema: alerts_log_schema,
        });
    }

    static instance() {
        if (!AlertsLogStore._instance) AlertsLogStore._instance = new AlertsLogStore();
        return AlertsLogStore._instance;
    }

    make_alert_log_id(id_str) {
        return new mongo_utils.ObjectId(id_str);
    }

    create(alert_log) {
        return P.resolve().then(async () => {
            alert_log._id = alert_log._id || this.make_alert_log_id();
            alert_log.time = alert_log.time || new Date();
            alert_log.read = alert_log.read || false;

            try {
                this._alertslogs.validate(alert_log);
                await this._alertslogs.insertOne(alert_log);
            } catch (err) {
                db_client.instance().check_duplicate_key_conflict(err, 'alerts_log');
            }
            return alert_log;
        });
    }

    get_unread_alerts_count(sysid) {
        return P.resolve().then(async () => {
            const severities = ['CRIT', 'MAJOR', 'INFO'];
            const unread_alerts = {};
            await Promise.all(severities.map(async sev => {
                const count = await this._alertslogs.countDocuments({
                    system: sysid,
                    severity: sev,
                    read: false
                });
                unread_alerts[sev] = count;
            }));
            return unread_alerts;
        });
    }

    async update_alerts_state(sysid, query, state) {
        const selector = this._create_selector(sysid, query);
        const update = {
            $set: {
                read: state
            }
        };
        return this._alertslogs.updateMany(selector, update);
    }


    async read_alerts(sysid, query, skip, limit) {
        const selector = this._create_selector(sysid, query);
        return this._alertslogs.find(selector, {
            skip,
            limit,
            sort: { _id: -1 }
        });
    }

    async find_alert(sev, sysid, alert, time) {
        return this._alertslogs.find(_.omitBy({
            system: sysid,
            severity: sev,
            alert: alert,
            time
        }, _.isUndefined));
    }


    //Internals
    _create_selector(sysid, query) {
        const { ids, till, since, severity, read } = query;

        let _id;
        if (ids) {
            const obj_ids = ids.map(id => new mongo_utils.ObjectId(id));
            _id = { $in: obj_ids };
        } else if (till) {
            _id = { $lt: new mongo_utils.ObjectId(till) };
        } else if (since) {
            _id = { $gt: new mongo_utils.ObjectId(since) };
        }

        return _.omitBy({
            _id,
            system: sysid,
            severity,
            read
        }, _.isUndefined);
    }


}


// EXPORTS
exports.AlertsLogStore = AlertsLogStore;
exports.instance = AlertsLogStore.instance;

/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const AlertsLogStore = require('./alerts_log_store').AlertsLogStore;
const nb_native = require('../../util/nb_native');
const alerts_rules = require('./alerts_rules');
const ActivityLogStore = require('../analytic_services/activity_log_store').ActivityLogStore;
const system_store = require('../system_services/system_store').get_instance();
const nodes_store = require('../node_services/nodes_store').NodesStore.instance();
const nodes_client = require('../node_services/nodes_client');
const SensitiveString = require('../../util/sensitive_string');

const SYSLOG_INFO_LEVEL = 5;
const SYSLOG_LOG_LOCAL0 = 'LOG_LOCAL0';

const NotificationTypes = Object.freeze({
    ALERT: 1,
    NOTIFICATION: 2,
    ACTIVITYLOG: 3,
});

const NODE_POPULATE_FIELDS = Object.freeze(['name', 'os_info', 'host_seq']);
const OBJECT_POPULATE_FIELDS = Object.freeze({
    bucket: 1,
    key: 1,
    version: 1,
    deleted: 1
});

class Dispatcher {

    /**
     * @returns {Dispatcher}
     */
    static instance() {
        if (!Dispatcher._instance) {
            Dispatcher._instance = new Dispatcher();
        }
        return Dispatcher._instance;
    }

    constructor() {
        this._pid = process.pid;
    }

    //Activity Log
    async activity(item) {
        item.desc = new SensitiveString(item.desc);
        dbg.log0('Adding ActivityLog entry', item);
        item.time = item.time || new Date();
        const created = await ActivityLogStore.instance().create(item);
        const activity_doc = created || item; // fall-back for unit tests
        if (!config.SEND_EVENTS_REMOTESYS) {
            return;
        }
        const l = {
            id: String(activity_doc._id),
            level: activity_doc.level,
            event: activity_doc.event,
        };
        // Resolve & enrich log data
        const logitem = await this._resolve_activity_item(activity_doc, l);
        this.send_syslog(JSON.stringify(logitem));
    }

    async read_activity_log(req) {
        const self = this;

        const query = _.pick(req.rpc_params, ['till', 'since', 'skip', 'limit']);
        if (req.rpc_params.event) {
            query.event = new RegExp(req.rpc_params.event);
        }
        query.system = req.system._id;

        const activity_log = await ActivityLogStore.instance().read_activity_log(query);
        const logs = await P.map(activity_log, async function(log_item) {
            const l = {
                id: String(log_item._id),
                level: log_item.level,
                event: log_item.event,
                time: log_item.time.getTime(),
            };

            if (log_item.desc) {
                l.desc = log_item.desc.split('\n');
            }
            await self._resolve_activity_item(log_item, l);
            return l;
        });
        return { logs };
    }

    //Remote Syslog
    send_syslog(item) {
        dbg.log3('Sending external syslog', item);
        nb_native().syslog(SYSLOG_INFO_LEVEL, 'NooBaa ' + item.description, SYSLOG_LOG_LOCAL0);
    }

    //Alerts
    alert(sev, sysid, alert, rule) {
        return P.resolve()
            .then(() => {
                if (rule) {
                    return rule(sev, sysid, alert);
                }
                return true;
            })
            .then(should_alert => {
                const sensitive_alert = new SensitiveString(alert);
                if (should_alert) {
                    dbg.log0('Sending alert', sensitive_alert);
                    return AlertsLogStore.instance().create({
                            system: sysid,
                            severity: sev,
                            alert: sensitive_alert
                        })
                        .then(res => {
                            this.send_syslog({
                                description: sensitive_alert
                            });
                        });
                }
                dbg.log3('Suppressed', sensitive_alert);
            });
    }

    get_unread_alerts_count(sysid) {
        return AlertsLogStore.instance().get_unread_alerts_count(sysid);
    }

    update_alerts_state(req) {
        const { query, state } = req.rpc_params;
        return AlertsLogStore.instance().update_alerts_state(req.system._id, query, state);
    }

    read_alerts(req) {
        const { query, skip = 0, limit = 100 } = req.rpc_params;
        return AlertsLogStore.instance().read_alerts(req.system._id, query, skip, limit)
            .then(alerts => P.map(alerts, function(alert_item) {
                return {
                    id: String(alert_item._id),
                    severity: alert_item.severity,
                    alert: alert_item.alert,
                    time: alert_item.time.getTime(),
                    read: alert_item.read
                };
            }));
    }

    async _resolve_activity_item(log_item, l) {
        await nodes_client.instance().populate_nodes(log_item.system, log_item, 'node', 'node', NODE_POPULATE_FIELDS);
        await MDStore.instance().populate_objects(log_item, 'obj', OBJECT_POPULATE_FIELDS);
        if (log_item.node) {
            const { name, pool, os_info, host_seq } = log_item.node;
            l.node = {};
            if (name) {
                l.node.linkable = true;
                l.node.name = `${os_info.hostname}#${host_seq}`;
                l.node.pool = pool;

            } else {
                l.node.linkable = false;
            }
        }

        if (log_item.obj) {
            const { key, version = 'null', bucket: bucket_id, deleted } = log_item.obj;
            l.obj = { key, version };
            l.obj.linkable = !deleted;

            const bucket = await system_store.data.get_by_id(bucket_id);
            if (bucket) {
                l.obj.bucket = bucket.name;
            } else {
                const { record } = await system_store.data.get_by_id_include_deleted(bucket_id, 'buckets');
                l.obj.bucket = record.name;
                l.obj.linkable = false;
            }
        }

        if (log_item.server) {
            if (!log_item.server.hostname) {
                log_item.server.hostname = '';
            }
            l.server = log_item.server;
        }

        const node = log_item.node && !l.node.linkable && await nodes_store.get_hidden_by_id(log_item.node);
        if (node) {
            const { host_name, host_sequence, pool: pool_id } = node;
            l.node.name = `${host_name}#${host_sequence}`;

            const pool = await system_store.data.get_by_id(pool_id);
            if (pool) {
                l.node.pool = pool.name;

            } else {
                const { record } = await system_store.data.get_by_id_include_deleted(pool_id, 'pools');
                l.node.pool = record && record.name;
            }
        }
        const tier = log_item.tier && await system_store.data.get_by_id_include_deleted(log_item.tier, 'tiers');

        if (tier) {
            l.tier = _.pick(tier.record, 'name');
            l.tier.linkable = tier.linkable;
        }
        const bucket = log_item.bucket && await system_store.data.get_by_id_include_deleted(log_item.bucket, 'buckets');
        if (bucket) {
            l.bucket = _.pick(bucket.record, 'name');
            l.bucket.linkable = bucket.linkable;
        }
        const pool = log_item.pool && await system_store.data.get_by_id_include_deleted(log_item.pool, 'pools');
        if (pool) {
            l.pool = _.pick(pool.record, 'name', 'resource_type');
            l.pool.name = l.pool.name.split('#')[0];
            l.pool.linkable = pool.linkable;
        }
        const account = log_item.account && await system_store.data.get_by_id_include_deleted(log_item.account, 'accounts');
        if (account) {
            l.account = _.pick(account.record, 'email');
            l.account.linkable = account.linkable;
        }
        const actor = log_item.actor && await system_store.data.get_by_id_include_deleted(log_item.actor, 'accounts');
        if (actor) {
            l.actor = _.pick(actor.record, 'email');
            l.actor.linkable = actor.linkable;
        }
        return l;
    }
}

Dispatcher._instance = undefined;

// EXPORTS
exports.Dispatcher = Dispatcher;
exports.instance = Dispatcher.instance;
exports.NotificationTypes = NotificationTypes;
exports.rules = alerts_rules;

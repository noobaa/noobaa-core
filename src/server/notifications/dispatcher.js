/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const AlertsLog = require('./alerts_log.js');
const server_rpc = require('../server_rpc');
const native_core = require('../../util/native_core')();
const ActivityLog = require('../analytic_services/activity_log');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();

var NotificationTypes = Object.freeze({
    ALERT: 1,
    NOTIFICATION: 2,
    ACTIVITYLOG: 3,
});

const NODE_POPULATE_FIELDS = Object.freeze(['name']);
const OBJECT_POPULATE_FIELDS = Object.freeze({
    key: 1
});

class Dispatcher {

    static instance() {
        if (!Dispatcher._instance) {
            Dispatcher._instance = new Dispatcher();
        }
        return Dispatcher._instance;
    }

    constructor() {
        this._ext_syslog = new native_core.Syslog();
        this._pid = process.pid;
    }

    //Activity Log
    activity(item) {
        var self = this;
        dbg.log2('Adding ActivityLog entry', item);
        return ActivityLog.create(item)
            .then(() => {
                if (!config.SEND_EVENTS_REMOTESYS) {
                    return P.resolve();
                }
                var l = {
                    id: String(item._id),
                    level: item.level,
                    event: item.event,
                };
                return self._resolve_activity_item(item, l);
            })
            .then(logitem => self.send_syslog(JSON.stringify(logitem)));
    }

    read_activity_log(req) {
        var self = this;
        var q = ActivityLog.find({
            system: req.system._id,
        });

        var reverse = true;
        if (req.rpc_params.till) {
            // query backwards from given time
            req.rpc_params.till = new Date(req.rpc_params.till);
            q.where('time').lt(req.rpc_params.till)
                .sort('-time');

        } else if (req.rpc_params.since) {
            // query forward from given time
            req.rpc_params.since = new Date(req.rpc_params.since);
            q.where('time').gte(req.rpc_params.since)
                .sort('time');
            reverse = false;
        } else {
            // query backward from last time
            q.sort('-time');
        }
        if (req.rpc_params.event) {
            q.where({
                event: new RegExp(req.rpc_params.event)
            });
        }
        if (req.rpc_params.events) {
            q.where('event').in(req.rpc_params.events);
        }
        if (req.rpc_params.csv) {
            //limit to million lines just in case (probably ~100MB of text)
            q.limit(1000000);
        } else {
            if (req.rpc_params.skip) q.skip(req.rpc_params.skip);
            q.limit(req.rpc_params.limit || 10);
        }

        return P.resolve(q.lean().exec())
            .then(logs => P.map(logs, function(log_item) {
                var l = {
                    id: String(log_item._id),
                    level: log_item.level,
                    event: log_item.event,
                    time: log_item.time.getTime(),
                };

                if (log_item.desc) {
                    l.desc = log_item.desc.split('\n');
                }
                return P.resolve(self._resolve_activity_item(log_item, l))
                    .return(l);
            }))
            .then(logs => {
                if (reverse) {
                    logs.reverse();
                }
                return {
                    logs: logs
                };
            });
    }

    //Remote Syslog
    send_syslog(item) {
        dbg.log3('Sending external syslog', item);
        const INFO_LEVEL = 5;
        this._ext_syslog.log(INFO_LEVEL, 'NooBaa ' + item.description);
    }

    //Alerts
    alert(sev, sysid, alert) {
        dbg.log3('Sending alert', alert);
        return AlertsLog.create({
                system: sysid,
                severity: sev,
                alert: alert
            })
            .then(res => {
                this.send_syslog({
                    description: alert
                });
                //TODO:: need to suppress alerts of the same kind
                return server_rpc.client.redirector.publish_alerts({
                    request_params: {
                        severity: sev,
                        id: res._id
                    }
                });
            });
    }

    get_unread_alerts_count(sysid) {
        var q = AlertsLog.count({
            system: sysid,
            read: false
        });

        return P.resolve(q.lean().exec())
            .then(num => num);
    }

    mark_alerts_read(req) {
        let query = {};
        if (req.rpc_params.ids) {
            query = {
                _id: {
                    $in: req.rpc_params.ids
                }
            };
        }
        return AlertsLog.update(query, {
            read: req.rpc_params.state
        }).exec();
    }

    read_alerts(req) {
        var q = AlertsLog.find({
            system: req.system._id,
        });

        if (req.rpc_params.till) {
            // query backwards from given time
            req.rpc_params.till = new Date(req.rpc_params.till);
            q.where('time').lt(req.rpc_params.till)
                .sort('-time');

        } else if (req.rpc_params.since) {
            // query forward from given time
            req.rpc_params.since = new Date(req.rpc_params.since);
            q.where('time').gte(req.rpc_params.since)
                .sort('time');
        } else {
            // query backward from last time
            q.sort('-time');
        }

        if (req.rpc_params.skip) q.skip(req.rpc_params.skip);
        q.limit(req.rpc_params.limit || 10);

        return P.resolve(q.lean().exec())
            .then(alerts => P.map(alerts, function(alert_item) {
                var l = {
                    id: String(alert_item._id),
                    severity: alert_item.severity,
                    alert: alert_item.alert,
                    time: alert_item.time.getTime(),
                };
                return l;
            }))
            .then(alerts => ({
                alerts: alerts
            }));
    }

    //Internals
    _resolve_activity_item(log_item, l) {
        return P.resolve()
            .then(() => nodes_client.instance().populate_nodes(log_item.system, log_item, 'node', NODE_POPULATE_FIELDS))
            .then(() => MDStore.instance().populate_objects(log_item, 'obj', OBJECT_POPULATE_FIELDS))
            .then(() => {
                if (log_item.node) {
                    l.node = _.pick(log_item.node, 'name');
                    if (l.node.name) {
                        l.node.linkable = true;
                    } else {
                        l.node.linkable = false;
                        l.node.name = '(deleted node)';
                    }
                }

                if (log_item.obj) {
                    l.obj = _.pick(log_item.obj, 'key');
                }

                if (log_item.server) {
                    l.server = log_item.server;
                }

                return P.resolve(log_item.tier && system_store.data.get_by_id_include_deleted(log_item.tier, 'tiers'));
            })
            .then(tier => {
                if (tier) {
                    l.tier = _.pick(tier.record, 'name');
                    l.tier.linkable = tier.linkable;
                }
                return P.resolve(log_item.bucket && system_store.data.get_by_id_include_deleted(log_item.bucket, 'buckets'));
            })
            .then(bucket => {
                if (bucket) {
                    l.bucket = _.pick(bucket.record, 'name');
                    l.bucket.linkable = bucket.linkable;
                }
                return P.resolve(log_item.pool && system_store.data.get_by_id_include_deleted(log_item.pool, 'pools'));
            })
            .then(pool => {
                if (pool) {
                    l.pool = _.pick(pool.record, 'name');
                    l.pool.linkable = pool.linkable;
                }
                return P.resolve(log_item.account && system_store.data.get_by_id_include_deleted(log_item.account, 'accounts'));
            })
            .then(account => {
                if (account) {
                    l.account = _.pick(account.record, 'email');
                }
                return P.resolve(log_item.actor && system_store.data.get_by_id_include_deleted(log_item.actor, 'accounts'));
            })
            .then(actor => {
                if (actor) {
                    l.actor = _.pick(actor.record, 'email');
                }
                return log_item;
            });
    }
}

// EXPORTS
exports.Dispatcher = Dispatcher;
exports.instance = Dispatcher.instance;
exports.NotificationTypes = NotificationTypes;

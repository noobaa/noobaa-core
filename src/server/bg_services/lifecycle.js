/* Copyright (C) 2022 NooBaa */
'use strict';

const _ = require('lodash');
const moment = require('moment');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const server_rpc = require('../server_rpc');
const system_store = require('../system_services/system_store').get_instance();
const auth_server = require('../common_services/auth_server');

const LIFECYCLE = {
    schedule_min: 5 * 1000 * 60 // run every 5 minutes
};

function get_expiration_timestamp(expiration) {
    if (!expiration) {
        return undefined; // undefined
    } else if (expiration.date) {
        return Math.floor(new Date(expiration.date).getTime() / 1000);
    } else if (expiration.days) {
        return moment().subtract(expiration.days, 'days').unix();
    }
}

function get_filter_field(filter, field) {
    if (!filter) {
        return undefined;
    } else if (filter.and) {
        return filter.and[field];
    } else {
        return filter[field];
    }
}

function get_prefix(filter) {
    return get_filter_field(filter, 'prefix');
}

function get_size_less_than(filter) {
    return get_filter_field(filter, 'object_size_less_than');
}

function get_size_greater_than(filter) {
    return get_filter_field(filter, 'object_size_greater_than');
}

function get_tags(filter) {
    if (!filter) {
        return undefined;
    } else if (filter.tag) {
        return [ filter.tag ];
    } else if (filter.and) {
        return filter.and.tags;
    }
}

async function handle_bucket_rule(system, rule, j, bucket) {
    dbg.log0('LIFECYCLE HANDLING BUCKET:', bucket.name, '(bucket id:', bucket._id, ') BEGIN');
    const now = Date.now();
    const bucket_rule = bucket.name + '(bucket id:' + bucket._id + ') rule id(' + j + ') ' + rule.id;

    if (rule.status !== 'Enabled') {
        dbg.log0('LIFECYCLE SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule id', rule.id, 'rule', rule, 'not Enabled');
        return;
    }
    if (rule.last_sync && now - rule.last_sync < LIFECYCLE.schedule_min) {
        dbg.log0('LIFECYCLE SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule id', rule.id, 'rule', rule, 'now', now, 'last_sync', rule.last_sync, 'schedule min', LIFECYCLE.schedule_min);
        return;
    }
    if (rule.expiration === undefined) {
        dbg.log0('LIFECYCLE SKIP bucket:', bucket.name, '(bucket id:', bucket._id, ') rule id', rule.id, 'rule', rule, 'now', now, 'last_sync', rule.last_sync, 'no expiration');
        return;
    }
    dbg.log0('LIFECYCLE PROCESSING bucket:', bucket_rule);

    await server_rpc.client.object.delete_multiple_objects_by_filter({
        bucket: bucket.name,
        create_time: get_expiration_timestamp(rule.expiration),
        prefix: get_prefix(rule.filter),
        size_less: get_size_less_than(rule.filter),
        size_greater: get_size_greater_than(rule.filter),
        tags: get_tags(rule.filter),
    }, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        })
    });

    bucket.lifecycle_configuration_rules[j].last_sync = Date.now();
    dbg.log0('LIFECYCLE Done bucket:', bucket.name, '(bucket id:', bucket._id, ') done deletion of objects per rule',
        rule, 'time:', bucket.lifecycle_configuration_rules[j].last_sync);
    update_lifecycle_rules_last_sync(bucket, bucket.lifecycle_configuration_rules);
}

async function background_worker() {
    const system = system_store.data.systems[0];
    if (!system) return;
    try {
        dbg.log0('LIFECYCLE READ BUCKETS configuration: BEGIN');
        await system_store.refresh();
        dbg.log0('LIFECYCLE READ BUCKETS configuration buckets:', system_store.data.buckets.map((e) => e.name));
        for (const bucket of system_store.data.buckets) {
            dbg.log0('LIFECYCLE READ BUCKETS configuration bucket name:', bucket.name, "rules", bucket.lifecycle_configuration_rules);
            if (!bucket.lifecycle_configuration_rules || bucket.deleting) return;

            await P.all(_.map(bucket.lifecycle_configuration_rules,
                async (lifecycle_rule, j) => {
                    dbg.log0('LIFECYCLE READ BUCKETS configuration handle_bucket_rule bucket name:', bucket.name, "rule", lifecycle_rule, 'j', j);
                    handle_bucket_rule(system, lifecycle_rule, j, bucket);
                }
            ));
        }
    } catch (err) {
        dbg.error('LIFECYCLE FAILED processing', err, err.stack);
    }
    dbg.log0('LIFECYCLE: END');
}

function update_lifecycle_rules_last_sync(bucket, rules) {
    return system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                lifecycle_configuration_rules: rules
            }]
        }
    });
}
exports.background_worker = background_worker;

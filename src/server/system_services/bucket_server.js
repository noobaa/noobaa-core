/* Copyright (C) 2016 NooBaa */
/* eslint max-lines: ['error', 2000] */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const net = require('net');
const fs = require('fs');
const GoogleStorage = require('../../util/google_storage_wrap');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const BucketStatsStore = require('../analytic_services/bucket_stats_store').BucketStatsStore;
const fs_utils = require('../../util/fs_utils');
const js_utils = require('../../util/js_utils');
const { RpcError } = require('../../rpc');
const Dispatcher = require('../notifications/dispatcher');
const size_utils = require('../../util/size_utils');
const BigInteger = size_utils.BigInteger;
const server_rpc = require('../server_rpc');
const tier_server = require('./tier_server');
const http_utils = require('../../util/http_utils');
const cloud_utils = require('../../util/cloud_utils');
const nodes_client = require('../node_services/nodes_client');
const pool_server = require('../system_services/pool_server');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
const func_store = require('../func_services/func_store');
const node_allocator = require('../node_services/node_allocator');
const system_utils = require('../utils/system_utils');
const azure_storage = require('../../util/azure_storage_wrap');
const usage_aggregator = require('../bg_services/usage_aggregator');
const chunk_config_utils = require('../utils/chunk_config_utils');
const NetStorage = require('../../util/NetStorageKit-Node-master/lib/netstorage');
const { OP_NAME_TO_ACTION } = require('../../endpoint/s3/s3_utils');

const VALID_BUCKET_NAME_REGEXP =
    /^(([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/;

const EXTERNAL_BUCKET_LIST_TO = 30 * 1000; //30s

const trigger_properties = ['event_name', 'object_prefix', 'object_suffix'];

let optimal_pool_existed = false;

function new_bucket_defaults(name, system_id, tiering_policy_id, owner_account_id, tag, lock_enabled) {
    let now = Date.now();
    return {
        _id: system_store.new_system_store_id(),
        name: name,
        tag: js_utils.default_value(tag, ''),
        system: system_id,
        owner_account: owner_account_id,
        tiering: tiering_policy_id,
        storage_stats: {
            chunks_capacity: 0,
            blocks_size: 0,
            pools: {},
            objects_size: 0,
            objects_count: 0,
            objects_hist: [],
            // new buckets creation date will be rounded down to config.MD_AGGREGATOR_INTERVAL (30 seconds)
            last_update: (Math.floor(now / config.MD_AGGREGATOR_INTERVAL) * config.MD_AGGREGATOR_INTERVAL) -
                (2 * config.MD_GRACE_IN_MILLISECONDS),
        },
        lambda_triggers: [],
        versioning: config.WORM_ENABLED && lock_enabled ? 'ENABLED' : 'DISABLED',
        object_lock_configuration: config.WORM_ENABLED ? {
            object_lock_enabled: lock_enabled ? 'Enabled' : 'Disabled',
        } : undefined
    };
}

/**
 *
 * CREATE_BUCKET
 *
 */
async function create_bucket(req) {

    validate_bucket_creation(req);
    await validate_pool_constraints();

    let tiering_policy;
    const changes = {
        insert: {},
        update: {}
    };

    const mongo_pool = pool_server.get_internal_mongo_pool(req.system);
    if (!mongo_pool) throw new RpcError('MONGO_POOL_NOT_FOUND');

    if (req.rpc_params.tiering) {
        tiering_policy = resolve_tiering_policy(req, req.rpc_params.tiering);
    } else {
        // we create dedicated tier and tiering policy for the new bucket
        // that uses the default_pool of that account
        const default_pool = req.account.default_pool;
        const chunk_config = chunk_config_utils.resolve_chunk_config(
            req.rpc_params.chunk_coder_config, req.account, req.system);
        if (!chunk_config._id) {
            chunk_config._id = system_store.new_system_store_id();
            changes.insert.chunk_configs = [chunk_config];
        }
        const bucket_with_suffix = req.rpc_params.name.unwrap() + '#' + Date.now().toString(36);
        const mirrors = [{
            _id: system_store.new_system_store_id(),
            spread_pools: [default_pool._id]
        }];
        const tier = tier_server.new_tier_defaults(
            bucket_with_suffix,
            req.system._id,
            chunk_config._id,
            mirrors
        );
        tiering_policy = tier_server.new_policy_defaults(
            bucket_with_suffix,
            req.system._id,
            req.rpc_params.chunk_split_config, [{
                tier: tier._id,
                order: 0,
                spillover: false,
                disabled: false
            }]
        );
        changes.insert.tieringpolicies = [tiering_policy];
        changes.insert.tiers = [tier];
    }

    const bucket = new_bucket_defaults(
        req.rpc_params.name,
        req.system._id,
        tiering_policy._id,
        req.account._id,
        req.rpc_params.tag,
        req.rpc_params.lock_enabled);

    if (req.rpc_params.namespace) {
        const read_resources = _.compact(req.rpc_params.namespace.read_resources
            .map(ns_name => req.system.namespace_resources_by_name[ns_name] &&
                req.system.namespace_resources_by_name[ns_name]._id)
        );
        const wr_obj = req.system.namespace_resources_by_name[req.rpc_params.namespace.write_resource];
        const write_resource = wr_obj && wr_obj._id;
        if (req.rpc_params.namespace.read_resources &&
            (!read_resources.length ||
                (read_resources.length !== req.rpc_params.namespace.read_resources.length)
            )) {
            throw new RpcError('INVALID_READ_RESOURCES');
        }
        if (req.rpc_params.namespace.write_resource && !write_resource) {
            throw new RpcError('INVALID_WRITE_RESOURCES');
        }

        const caching = req.rpc_params.namespace.caching && {
            ttl_ms: config.NAMESPACE_CACHING.DEFAULT_CACHE_TTL_MS,
            ...req.rpc_params.namespace.caching,
        };

        // reorder read resources so that the write resource is the first in the list
        const ordered_read_resources = [write_resource].concat(read_resources.filter(resource => resource !== write_resource));

        bucket.namespace = {
            read_resources: ordered_read_resources,
            write_resource,
            caching
        };
    }
    if (req.rpc_params.bucket_claim) {
        // TODO: Should implement validity checks
        bucket.bucket_claim = req.rpc_params.bucket_claim;
    }
    changes.insert.buckets = [bucket];
    Dispatcher.instance().activity({
        event: 'bucket.create',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        bucket: bucket._id,
        desc: `${bucket.name.unwrap()} was created by ${req.account && req.account.email.unwrap()}`,
    });

    // Grant the account a full access for the newly created bucket.
    if (req.account.allowed_buckets && !req.account.allowed_buckets.full_permission) {
        changes.update.accounts = [{
            _id: req.account._id,
            $push: {
                'allowed_buckets.permission_list': bucket._id,
            }
        }];
    }

    await system_store.make_changes(changes);
    req.load_auth();
    if (req.rpc_params.bucket_claim) {
        try {
            // Trigger partial aggregation for the Prometheus metrics
            server_rpc.client.stats.get_partial_stats({
                requester: 'create_bucket',
            }, {
                auth_token: req.auth_token
            });
        } catch (error) {
            dbg.error('create_bucket: get_partial_stats failed with', error);
        }
    }
    let created_bucket = find_bucket(req);
    return get_bucket_info({ bucket: created_bucket });
}

async function validate_pool_constraints() {
    if (config.ALLOW_BUCKET_CREATE_ON_INTERNAL !== true && !optimal_pool_existed) {
        const non_mongo_optimal_pool_id = await pool_server.get_optimal_non_mongo_pool_id();
        if (!non_mongo_optimal_pool_id) throw new RpcError('SERVICE_UNAVAILABLE', 'Not allowed to create new buckets on internal pool');
        optimal_pool_existed = true;
    }
}

/**
 *
 * GET_BUCKET_TAGGING
 *
 */
async function get_bucket_tagging(req) {
    dbg.log0('get_bucket_tagging:', req.rpc_params);
    const bucket = find_bucket(req);
    return {
        tagging: bucket.tagging,
    };
}


/**
 *
 * PUT_BUCKET_TAGGING
 *
 */
async function put_bucket_tagging(req) {
    dbg.log0('put_bucket_tagging:', req.rpc_params);
    const bucket = find_bucket(req);
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                tagging: req.rpc_params.tagging
            }]
        }
    });
}


/**
 *
 * DELETE_BUCKET_TAGGING
 *
 */
async function delete_bucket_tagging(req) {
    dbg.log0('delete_bucket_tagging:', req.rpc_params);
    const bucket = find_bucket(req);
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                $unset: { tagging: 1 }
            }]
        }
    });
}


async function get_bucket_encryption(req) {
    dbg.log0('get_bucket_encryption:', req.rpc_params);
    const bucket = find_bucket(req);
    return {
        encryption: bucket.encryption,
    };
}


/**
 *
 * GET_BUCKET_WEBSITE
 *
 */
async function get_bucket_website(req) {
    dbg.log0('get_bucket_website:', req.rpc_params);
    const bucket = find_bucket(req, req.rpc_params.name);
    return {
        website: bucket.website,
    };
}


async function put_bucket_encryption(req) {
    dbg.log0('put_bucket_encryption:', req.rpc_params);
    const bucket = find_bucket(req);
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                encryption: req.rpc_params.encryption
            }]
        }
    });
}

async function get_bucket_policy(req) {
    dbg.log0('get_bucket_policy:', req.rpc_params);
    const bucket = find_bucket(req, req.rpc_params.name);
    return {
        policy: bucket.s3_policy,
    };
}


async function put_bucket_policy(req) {
    dbg.log0('put_bucket_policy:', req.rpc_params);
    const bucket = find_bucket(req, req.rpc_params.name);
    _validate_s3_policy(req.rpc_params.policy, bucket.name);
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                s3_policy: req.rpc_params.policy
            }]
        }
    });
}

function _validate_s3_policy(policy, bucket_name) {
    const all_op_names = _.compact(_.flatMap(OP_NAME_TO_ACTION, action => [action.regular, action.versioned]));
    for (const statement of policy.statement) {
        for (const principal of statement.principal) {
            if (principal.unwrap() !== '*') {
                const account = system_store.get_account_by_email(principal);
                if (!account) {
                    throw new RpcError('MALFORMED_POLICY', 'Invalid principal in policy', { detail: principal });
                }
            }
        }
        for (const resource of statement.resource) {
            const resource_bucket_part = resource.split('/')[0];
            const resource_regex = RegExp(`^${resource_bucket_part.replace(/\?/g, '.?').replace(/\*/g, '.*')}$`);
            if (!resource_regex.test('arn:aws:s3:::' + bucket_name)) {
                throw new RpcError('MALFORMED_POLICY', 'Policy has invalid resource', { detail: resource });
            }
        }
        for (const action of statement.action) {
            if (action !== 's3:*' && !all_op_names.includes(action)) {
                throw new RpcError('MALFORMED_POLICY', 'Policy has invalid action', { detail: action });
            }
        }
        // TODO: Need to validate that the resource comply with the action
    }
}


async function delete_bucket_policy(req) {
    dbg.log0('delete_bucket_policy:', req.rpc_params);
    const bucket = find_bucket(req, req.rpc_params.name);
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                $unset: { s3_policy: 1 }
            }]
        }
    });
}


/**
 *
 * PUT_BUCKET_WEBSITE
 *
 */
async function put_bucket_website(req) {
    dbg.log0('put_bucket_website:', req.rpc_params);
    const bucket = find_bucket(req, req.rpc_params.name);
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                website: req.rpc_params.website
            }]
        }
    });
}


async function delete_bucket_encryption(req) {
    dbg.log0('delete_bucket_encryption:', req.rpc_params);
    const bucket = find_bucket(req);
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                $unset: { encryption: 1 }
            }]
        }
    });
}


/**
 *
 * DELETE_BUCKET_WEBSITE
 *
 */
async function delete_bucket_website(req) {
    dbg.log0('delete_bucket_website:', req.rpc_params);
    const bucket = find_bucket(req, req.rpc_params.name);
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                $unset: { website: 1 }
            }]
        }
    });
}


/**
 *
 * READ_BUCKET
 *
 */
function read_bucket(req) {
    var bucket = find_bucket(req);
    var pools = [];

    _.forEach(bucket.tiering.tiers, tier_and_order => {
        _.forEach(tier_and_order.tier.mirrors, mirror_object => {
            pools = _.concat(pools, mirror_object.spread_pools);
        });
    });
    pools = _.compact(pools);
    let pool_names = pools.map(pool => pool.name);
    return P.props({
            bucket,
            nodes_aggregate_pool: nodes_client.instance().aggregate_nodes_by_pool(pool_names, req.system._id),
            hosts_aggregate_pool: nodes_client.instance().aggregate_hosts_by_pool(null, req.system._id),
            num_of_objects: MDStore.instance().count_objects_of_bucket(bucket._id),
            func_configs: get_bucket_func_configs(req, bucket),
            unused_refresh_tiering_alloc: node_allocator.refresh_tiering_alloc(bucket.tiering),
        })
        .then(get_bucket_info);
}

async function read_bucket_sdk_info(req) {
    const bucket = find_bucket(req);

    const system = req.system;

    const reply = {
        name: bucket.name,
        website: bucket.website,
        s3_policy: bucket.s3_policy,
        active_triggers: _.map(
            _.filter(bucket.lambda_triggers, 'enabled'),
            trigger => _.pick(trigger, trigger_properties)
        ),
        system_owner: bucket.system.owner.email,
        bucket_owner: bucket.owner_account.email,
    };

    if (bucket.namespace) {
        reply.namespace = {
            write_resource: pool_server.get_namespace_resource_extended_info(
                system.namespace_resources_by_name[bucket.namespace.write_resource.name]
            ),
            read_resources: _.map(bucket.namespace.read_resources, rs => pool_server.get_namespace_resource_extended_info(rs)),
            caching: bucket.namespace.caching,
        };
    }

    return reply;
}

/**
 *
 * UPDATE_BUCKET
 *
 */
async function update_bucket(req) {
    const bucket = find_bucket(req, req.name);
    const conf = bucket.object_lock_configuration;
    if (config.WORM_ENABLED && conf && conf.object_lock_enabled === 'Enabled' && req.rpc_params.versioning === 'SUSPENDED') {
        throw new RpcError('INVALID_BUCKET_STATE', 'An Object Lock configuration is present on this bucket, so the versioning state cannot be changed.');
    }

    const new_req = { ...req, rpc_params: [req.rpc_params] };
    return update_buckets(new_req);
}


function get_bucket_changes(req, update_request, bucket, tiering_policy) {
    const changes = {
        updates: {},
        inserts: {},
        events: [],
        alerts: []
    };
    let quota = update_request.quota;
    // const spillover_sent = !_.isUndefined(update_request.spillover);

    let single_bucket_update = {
        _id: bucket._id
    };
    changes.updates.buckets = [single_bucket_update];

    if (update_request.namespace) {
        get_bucket_changes_namespace(req, bucket, update_request, single_bucket_update);
    }

    if (update_request.new_name) {
        single_bucket_update.name = update_request.new_name;
    }
    if (update_request.new_tag) {
        single_bucket_update.tag = update_request.new_tag;
    }
    if (tiering_policy) {
        single_bucket_update.tiering = tiering_policy._id;
    }
    if (update_request.versioning) {
        get_bucket_changes_versioning(req, bucket, update_request, single_bucket_update, changes);
    }

    if (!_.isUndefined(quota)) {
        get_bucket_changes_quota(req, bucket, quota, single_bucket_update, changes);
    }

    // if (spillover_sent) {
    //     get_bucket_changes_spillover(req, bucket, update_request, tiering_policy, changes);
    // }

    return changes;
}

function get_bucket_changes_versioning(req, bucket, update_request, single_bucket_update, changes) {
    const versioning_event = {
        event: 'bucket.versioning',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        bucket: bucket._id,
        desc: `Bucket versioning was changed from ${bucket.versioning} to ${update_request.versioning}`
    };

    if (update_request.versioning === 'DISABLED') {
        throw new RpcError('BAD_REQUEST', 'Cannot set versioning to DISABLED');
    }
    if (bucket.namespace) {
        throw new RpcError('BAD_REQUEST', 'Cannot set versioning on namespace buckets');
    }

    single_bucket_update.versioning = update_request.versioning;
    changes.events.push(versioning_event);
}

function get_bucket_changes_namespace(req, bucket, update_request, single_bucket_update) {
    if (!bucket.namespace) throw new RpcError('CANNOT_CONVERT_BUCKET_TO_NAMESPACE_BUCKET');
    if (!update_request.namespace.read_resources.length) throw new RpcError('INVALID_READ_RESOURCES');

    const read_resources = _.compact(update_request.namespace.read_resources
        .map(ns_name => req.system.namespace_resources_by_name[ns_name] && req.system.namespace_resources_by_name[ns_name]._id));
    if (!read_resources.length || (read_resources.length !== update_request.namespace.read_resources.length)) {
        throw new RpcError('INVALID_READ_RESOURCES');
    }
    _.set(single_bucket_update, 'namespace.read_resources', read_resources);
    const wr_obj = req.system.namespace_resources_by_name[update_request.namespace.write_resource];
    const write_resource = wr_obj && wr_obj._id;
    if (!write_resource) throw new RpcError('INVALID_WRITE_RESOURCES');
    _.set(single_bucket_update, 'namespace.write_resource', write_resource);
    if (!_.includes(update_request.namespace.read_resources, update_request.namespace.write_resource)) {
        throw new RpcError('INVALID_NAMESPACE_CONFIGURATION');
    }

    // reorder read resources so that the write resource is the first in the list
    const ordered_read_resources = [write_resource].concat(read_resources.filter(resource => resource !== write_resource));

    _.set(single_bucket_update, 'namespace.read_resources', ordered_read_resources);
    _.set(single_bucket_update, 'namespace.write_resource', write_resource);
}

function get_bucket_changes_quota(req, bucket, quota, single_bucket_update, changes) {
    const quota_event = {
        event: 'bucket.quota',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        bucket: bucket._id,
    };

    if (quota === null) {
        single_bucket_update.$unset = { quota: 1 };
        quota_event.desc = `Bucket quota was removed from ${bucket.name.unwrap()} by ${req.account && req.account.email.unwrap()}`;
    } else {
        if (quota.size <= 0) throw new RpcError('BAD_REQUEST', 'quota size must be positive');
        single_bucket_update.quota = quota;
        quota.value = size_utils.size_unit_to_bigint(quota.size, quota.unit).toJSON();
        let used_percent = system_utils.get_bucket_quota_usage_percent(bucket, quota);
        if (used_percent >= 100) {
            changes.alerts.push({
                sev: 'MAJOR',
                sysid: system_store.data.systems[0]._id,
                alert: `Bucket ${bucket.name.unwrap()} exceeded its configured quota of ${
                    size_utils.human_size(quota.value)
                }, uploads to this bucket will be denied`,
                rule: Dispatcher.rules.once_daily
            });
            dbg.warn(`the bucket ${bucket.name} used capacity is more than the updated quota. uploads will be denied`);
        } else if (used_percent >= 90) {
            changes.alerts.push({
                sev: 'INFO',
                sysid: system_store.data.systems[0]._id,
                alert: `Bucket ${bucket.name.unwrap()} exceeded 90% of its configured quota of ${size_utils.human_size(quota.value)}`,
                rule: Dispatcher.rules.once_daily
            });
        }
        quota_event.desc = `Quota of ${size_utils.human_size(quota.value)} was set on ${bucket.name.unwrap()} by ${req.account && req.account.email.unwrap()}`;
    }
    changes.events.push(quota_event);
}

/**
 *
 * GET_BUCKET_UPDATE
 *
 */
async function update_buckets(req) {
    const insert_changes = {};
    const update_changes = {
        buckets: []
    };
    let update_events = [];
    let update_alerts = [];
    dbg.log0(`update buckets: updating wit params:`, req.rpc_params);
    for (const update_request of req.rpc_params) {
        const bucket = find_bucket(req, update_request.name);
        const tiering_policy = update_request.tiering &&
            resolve_tiering_policy(req, update_request.tiering);
        const { updates, inserts, events, alerts } = get_bucket_changes(
            req, update_request, bucket, tiering_policy);
        _.mergeWith(insert_changes, inserts, (existing_inserts, new_inserts) => (existing_inserts || []).concat(new_inserts));
        _.mergeWith(update_changes, updates, (existing_inserts, new_inserts) => (existing_inserts || []).concat(new_inserts));
        update_events = update_events.concat(events);
        update_alerts = update_alerts.concat(alerts);
    }

    await system_store.make_changes({
        insert: insert_changes,
        update: update_changes
    });

    P.map(update_events, event => Dispatcher.instance().activity(event));
    P.map(update_alerts, alert => Dispatcher.instance().alert(alert.sev, alert.sysid, alert.alert, alert.rule));
}


/**
 *
 * UPDATE_BUCKET_S3_ACCESS
 *
 */
function update_bucket_s3_access(req) {
    const bucket = find_bucket(req);
    const allowed_accounts = req.rpc_params.allowed_accounts.map(
        email => system_store.get_account_by_email(email)
    );

    const added_accounts = [];
    const removed_accounts = [];
    const updates = [];
    system_store.data.accounts.forEach(account => {
        if (!account.allowed_buckets ||
            (account.allowed_buckets && account.allowed_buckets.full_permission)) return;

        const is_allowed = account.allowed_buckets.permission_list.includes(bucket);
        const should_be_allowed = allowed_accounts.includes(account);

        if (!is_allowed && should_be_allowed) {
            added_accounts.push(account);
            updates.push({
                _id: account._id,
                $push: {
                    'allowed_buckets.permission_list': bucket._id
                }
            });
        } else if (is_allowed && !should_be_allowed) {
            removed_accounts.push(account);
            updates.push({
                _id: account._id,
                $pullAll: {
                    'allowed_buckets.permission_list': [bucket._id]
                }
            });
        }
    });

    return system_store.make_changes({
            update: {
                accounts: updates
            }
        })
        .then(() => {
            const desc_string = [];
            if (added_accounts.length > 0) {
                desc_string.push('Added accounts:');
                _.each(added_accounts, acc => desc_string.push(acc.email.unwrap()));
            }
            if (removed_accounts.length > 0) {
                desc_string.push('Removed accounts:');
                _.each(removed_accounts, acc => desc_string.push(acc.email.unwrap()));
            }

            Dispatcher.instance().activity({
                event: 'bucket.s3_access_updated',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
            check_for_lambda_permission_issue(req, bucket, removed_accounts);
        });
}

function check_for_lambda_permission_issue(req, bucket, removed_accounts) {
    if (!removed_accounts.length) return;
    if (!bucket.lambda_triggers || !bucket.lambda_triggers.length) return;
    _.forEach(bucket.lambda_triggers, trigger =>
        func_store.instance().read_func(req.system._id, trigger.func_name, trigger.func_version)
        .then(func => {
            const account = _.find(removed_accounts, acc => acc._id.toString() === func.exec_account.toString());
            if (account) {
                Dispatcher.instance().alert('MAJOR', req.system._id,
                    `Account’s ${account.email.unwrap()} ${bucket.name.unwrap()} bucket access was removed.
                    The configured lambda trigger for function ${func.name} will no longer be invoked`);
            }
        })
    );
}


async function delete_bucket_and_objects(req) {
    var bucket = find_bucket(req);

    // fail on namespace bucket
    if (bucket.namespace) {
        throw new RpcError('BAD_REQUEST', 'cannot perform delete_bucket_and_objects on namespace bucket');
    }
    const now = new Date();
    // mark the bucket as deleting. it will be excluded from system_store indexes
    // rename the bucket to prevent collisions if the a new bucket with the same name is created immediately.
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                $set: {
                    name: `${bucket.name.unwrap()}-deleting-${now.getTime()}`,
                    deleting: now
                }
            }]
        }
    });

    const req_account = req.account &&
        (req.account.email.unwrap() === config.OPERATOR_ACCOUNT_EMAIL ?
            'NooBaa operator' :
            req.account.email.unwrap());
    Dispatcher.instance().activity({
        event: 'bucket.delete',
        level: 'info',
        system: req.system._id,
        bucket: bucket._id,
        desc: `The bucket "${bucket.name.unwrap()}" and its content were deleted by ${req_account}`,
    });
}

/**
 *
 * DELETE_BUCKET
 *
 */
async function delete_bucket(req) {
    var bucket = find_bucket(req);
    // TODO before deleting tier and tiering_policy need to check they are not in use
    let tiering_policy = bucket.tiering;
    const reason = await can_delete_bucket(req.system, bucket);
    if (reason) {
        throw new RpcError(reason, 'Cannot delete bucket');
    }
    if (!req.rpc_params.internal_call) {
        Dispatcher.instance().activity({
            event: 'bucket.delete',
            level: 'info',
            system: req.system._id,
            actor: req.account && req.account._id,
            bucket: bucket._id,
            desc: `${bucket.name.unwrap()} was deleted by ${req.account && req.account.email.unwrap()}`,
        });
    }
    await system_store.make_changes({
        remove: {
            buckets: [bucket._id],
            tieringpolicies: [tiering_policy._id],
            tiers: _.compact(_.map(tiering_policy.tiers, tier_and_order => {
                const associated_tiering_policies = tier_server.get_associated_tiering_policies(tier_and_order.tier)
                    .filter(policy_id => String(policy_id) !== String(tiering_policy._id));
                if (_.isEmpty(associated_tiering_policies)) {
                    return tier_and_order.tier._id;
                }
            }))
        }
    });

    const accounts_update = _.compact(_.map(system_store.data.accounts,
        account => {
            if (!account.allowed_buckets ||
                (account.allowed_buckets && account.allowed_buckets.full_permission)) return;
            return {
                _id: account._id,
                $pullAll: {
                    'allowed_buckets.permission_list': [bucket._id]
                }
            };
        }));

    if (!_.isEmpty(accounts_update)) {
        await system_store.make_changes({
            update: {
                accounts: accounts_update
            }
        });
    }
}

/**
 *
 * DELETE_BUCKET_LIFECYCLE
 *
 */
function delete_bucket_lifecycle(req) {
    var bucket = find_bucket(req);
    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    $unset: {
                        lifecycle_configuration_rules: 1
                    }
                }]
            }
        })
        .then(() => {
            let desc_string = [];
            desc_string.push(`lifecycle configuration rules were removed for bucket ${bucket.name.unwrap()} by ${req.account && req.account.email.unwrap()}`);

            Dispatcher.instance().activity({
                event: 'bucket.delete_lifecycle_configuration_rules',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
        })
        .catch(function(err) {
            dbg.error('Error deleting lifecycle configuration rules', err, err.stack);
            throw err;
        });
}

/**
 *
 * LIST_BUCKETS
 *
 */
function list_buckets(req) {
    var buckets_by_name = _.filter(
        req.system.buckets_by_name,
        bucket => req.has_s3_bucket_permission(bucket) && !bucket.deleting
    );
    return {
        buckets: _.map(buckets_by_name, function(bucket) {
            return _.pick(bucket, 'name');
        })
    };
}


/**
 *
 * EXPORT BUCKET BANDWIDTH USAGE
 *
 */
function export_bucket_bandwidth_usage(req) {
    dbg.log0(`export_bucket_bandwidth_usage with params`, req.rpc_params);
    const bucket = find_bucket(req);
    const { since, till, name } = req.rpc_params;

    if (since > till) {
        dbg.error('since is larger than till. since =', since, 'till =', till);
        throw new RpcError('BAD_REQUEST', 'since must be less than till for export time range');
    }

    // generate csv file name:
    const since_str = (new Date(since)).toLocaleDateString()
        .replace(/\//g, '-');
    const till_str = (new Date(till)).toLocaleDateString()
        .replace(/\//g, '-');
    const file_name = `${name}_usage_${since_str}_to_${till_str}.csv`;
    const out_path = `/public/${file_name}`;
    const inner_path = `${process.cwd()}/build${out_path}`;
    return fs_utils.file_delete(inner_path)
        .then(() => fs_utils.create_path(`${process.cwd()}/build/public`))
        .then(() => usage_aggregator.get_bandwidth_report({ bucket: bucket._id, since, till, time_range: 'day' }))
        .then(entries => {
            const out_lines = entries.reduce((lines, entry) => {
                lines.push(`${entry.date}, ${entry.read_count}, ${entry.read_bytes}, ${entry.write_count}, ${entry.write_bytes}`);
                return lines;
            }, [`Date, Read Count, Bytes Read, Write Count, Bytes Written`]);
            return fs.writeFileAsync(inner_path, out_lines.join('\n'));
        })
        .then(() => out_path)
        .catch(err => {
            dbg.error('received error when writing to bucket usage csv file:', inner_path, err);
            throw err;
        });
}

async function get_bucket_throughput_usage(req) {
    const { buckets, since, till, resolution } = req.rpc_params;
    const report = await usage_aggregator.get_bandwith_over_time({
        buckets: buckets && buckets.map(bucket_name => req.system.buckets_by_name[bucket_name.unwrap()]._id),
        resolution,
        since,
        till
    });
    return report.map(entry => _.pick(entry,
        'start_time',
        'end_time',
        'read_count',
        'write_count',
        'write_bytes',
        'read_bytes'));
}



function get_objects_size_histogram(req) {
    return _.map(req.system.buckets_by_name, bucket => ({
        name: bucket.name,
        bins: _.get(bucket, 'storage_stats.objects_hist', []).map(bin => ({
            count: bin.count,
            sum: bin.aggregated_sum
        }))
    }));
}

async function get_buckets_stats_by_content_type(req) {
    const stats = await BucketStatsStore.instance().get_all_buckets_stats({ system: req.system._id });
    return stats.map(bucket_stats => ({
        name: system_store.data.get_by_id(bucket_stats._id).name,
        stats: bucket_stats.stats
    }));
}


/**
 *
 * SET_BUCKET_LIFECYCLE_CONFIGURATION_RULES
 *
 */
function set_bucket_lifecycle_configuration_rules(req) {
    dbg.log0('set bucket lifecycle configuration rules', req.rpc_params);

    var bucket = find_bucket(req);

    var lifecycle_configuration_rules = req.rpc_params.rules;

    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    lifecycle_configuration_rules: lifecycle_configuration_rules
                }]
            }
        })
        .then(() => {
            let desc_string = [];
            desc_string.push(`${bucket.name.unwrap()} was updated with lifecycle configuration rules by ${req.account && req.account.email.unwrap()}`);

            Dispatcher.instance().activity({
                event: 'bucket.set_lifecycle_configuration_rules',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
        })
        .catch(function(err) {
            dbg.error('Error setting lifecycle configuration rules', err, err.stack);
            throw err;
        });
}

/**
 *
 * GET_BUCKET_LIFECYCLE_CONFIGURATION_RULES
 *
 */
function get_bucket_lifecycle_configuration_rules(req) {
    dbg.log0('get bucket lifecycle configuration rules', req.rpc_params);
    var bucket = find_bucket(req);
    return bucket.lifecycle_configuration_rules || [];
}

/**
 *
 * GET_CLOUD_BUCKETS
 *
 */
function get_cloud_buckets(req) {
    dbg.log0('get cloud buckets', req.rpc_params);
    return P.fcall(function() {
            var connection = cloud_utils.find_cloud_connection(
                req.account,
                req.rpc_params.connection
            );
            if (connection.endpoint_type === 'AZURE') {
                let blob_svc = azure_storage.createBlobService(cloud_utils.get_azure_connection_string(connection));
                let used_cloud_buckets = cloud_utils.get_used_cloud_targets(['AZURE'],
                    system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources);
                return P.fromCallback(callback => blob_svc.listContainersSegmented(null, { maxResults: 100 }, callback))
                    .timeout(EXTERNAL_BUCKET_LIST_TO)
                    .then(data => data.entries.map(entry =>
                        _inject_usage_to_cloud_bucket(entry.name, connection.endpoint, used_cloud_buckets)
                    ));
            } else if (connection.endpoint_type === 'NET_STORAGE') {
                let used_cloud_buckets = cloud_utils.get_used_cloud_targets(['NET_STORAGE'],
                    system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources);

                const ns = new NetStorage({
                    hostname: connection.endpoint,
                    keyName: connection.access_key.unwrap(),
                    key: connection.secret_key.unwrap(),
                    cpCode: connection.cp_code,
                    // Just used that in order to not handle certificate mess
                    // TODO: Should I use SSL with HTTPS instead of HTTP?
                    ssl: false
                });

                // TODO: Shall I use any other method istead of listing the root cpCode dir?
                return P.fromCallback(callback => ns.dir(connection.cp_code, callback))
                    .timeout(EXTERNAL_BUCKET_LIST_TO)
                    .then(data => {
                        const files = data.body.stat.file;
                        const buckets = _.map(files.filter(f => f.type === 'dir'), prefix => ({ name: prefix.name }));
                        return buckets.map(bucket => _inject_usage_to_cloud_bucket(bucket.name, connection.endpoint, used_cloud_buckets));
                    });
            } else if (connection.endpoint_type === 'GOOGLE') {
                let used_cloud_buckets = cloud_utils.get_used_cloud_targets(['GOOGLE'],
                    system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources);
                let key_file;
                try {
                    key_file = JSON.parse(connection.secret_key.unwrap());
                } catch (err) {
                    throw new RpcError('BAD_REQUEST', 'connection does not contain a key_file in json format');
                }
                const credentials = _.pick(key_file, 'client_email', 'private_key');
                const storage = new GoogleStorage({
                    projectId: key_file.project_id,
                    credentials
                });
                return storage.getBuckets()
                    .then(data => data[0].map(bucket =>
                        _inject_usage_to_cloud_bucket(bucket.name, connection.endpoint, used_cloud_buckets)));
            } else { //else if AWS
                let used_cloud_buckets = cloud_utils.get_used_cloud_targets(['AWS', 'S3_COMPATIBLE', 'FLASHBLADE', 'IBM_COS'],
                    system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources);
                var s3 = new AWS.S3({
                    endpoint: connection.endpoint,
                    accessKeyId: connection.access_key.unwrap(),
                    secretAccessKey: connection.secret_key.unwrap(),
                    signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(connection.endpoint, connection.auth_method),
                    s3DisableBodySigning: cloud_utils.disable_s3_compatible_bodysigning(connection.endpoint),
                    httpOptions: {
                        agent: http_utils.get_unsecured_http_agent(connection.endpoint)
                    }
                });
                return P.ninvoke(s3, "listBuckets")
                    .timeout(EXTERNAL_BUCKET_LIST_TO)
                    .then(data => data.Buckets.map(bucket =>
                        _inject_usage_to_cloud_bucket(bucket.Name, connection.endpoint, used_cloud_buckets)
                    ));
            }
        })
        .catch(P.TimeoutError, err => {
            dbg.log0('failed reading (t/o) external buckets list', req.rpc_params);
            throw err;
        })
        .catch(function(err) {
            dbg.error("get_cloud_buckets ERROR", err.stack || err);
            throw err;
        });

}

/**
 *
 * ADD_BUCKET_LAMBDA_TRIGGER
 *
 */
function add_bucket_lambda_trigger(req) {
    dbg.log0('add new bucket lambda trigger', req.rpc_params);
    const new_trigger = req.rpc_params;
    new_trigger.func_version = new_trigger.func_version || '$LATEST';
    const bucket = find_bucket(req, req.rpc_params.bucket_name);
    return P.resolve()
        .then(() => validate_trigger_update(req, bucket, new_trigger))
        .then(() => {
            const trigger = _.omitBy({
                _id: system_store.new_system_store_id(),
                event_name: new_trigger.event_name,
                func_name: new_trigger.func_name,
                func_version: new_trigger.func_version,
                enabled: new_trigger.enabled !== false,
                object_prefix: new_trigger.object_prefix || undefined,
                object_suffix: new_trigger.object_suffix || undefined
            }, _.isUndefined);
            return system_store.make_changes({
                update: {
                    buckets: [{
                        _id: bucket._id,
                        $push: { lambda_triggers: trigger },
                    }]
                }
            });
        })
        .return();
}

/**
 *
 * DELETE_BUCKET_LAMBDA_TRIGGER
 *
 */
function delete_bucket_lambda_trigger(req) {
    dbg.log0('delete bucket lambda trigger', req.rpc_params);
    const trigger_id = req.rpc_params.id;
    var bucket = find_bucket(req, req.rpc_params.bucket_name);
    const trigger = bucket.lambda_triggers.find(trig => trig._id.toString() === trigger_id);
    if (!trigger) {
        throw new RpcError('NO_SUCH_TRIGGER', 'This trigger does not exists: ' + trigger_id);
    }
    return P.resolve()
        .then(() => system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    $pull: {
                        lambda_triggers: {
                            _id: trigger._id
                        }
                    }
                }]
            }
        })).return();
}

function update_bucket_lambda_trigger(req) {
    dbg.log0('update bucket lambda trigger', req.rpc_params);
    const updates = _.pick(req.rpc_params, 'event_name', 'func_name', 'func_version', 'enabled', 'object_prefix', 'object_suffix');
    if (_.isEmpty(updates)) return;
    updates.func_version = updates.func_version || '$LATEST';
    var bucket = find_bucket(req, req.rpc_params.bucket_name);
    const trigger = _.find(bucket.lambda_triggers, trig => trig._id.toString() === req.rpc_params.id);
    if (!trigger) {
        throw new RpcError('NO_SUCH_TRIGGER', 'This trigger does not exists: ' + req.rpc_params._id);
    }
    const validate_trigger = { ...trigger, ...updates };
    return P.resolve()
        .then(() => validate_trigger_update(req, bucket, validate_trigger))
        .then(() => system_store.make_changes({
            update: {
                buckets: [{
                    $find: { _id: bucket._id, 'lambda_triggers._id': trigger._id },
                    $set: _.mapKeys(updates, (value, key) => `lambda_triggers.$.${key}`)
                }]
            }
        }))
        .return();
}


async function update_all_buckets_default_pool(req) {
    const pool_name = req.rpc_params.pool_name;
    const pool = req.system.pools_by_name[pool_name];
    if (!pool) throw new RpcError('INVALID_POOL_NAME');
    const internal_pool = pool_server.get_internal_mongo_pool(pool.system);
    if (String(pool._id) === String(internal_pool._id)) return;
    const buckets_with_internal_pool = _.filter(req.system.buckets_by_name, bucket =>
        is_using_internal_storage(bucket, internal_pool));
    if (!buckets_with_internal_pool.length) return;

    const updates = [];
    for (const bucket of buckets_with_internal_pool) {
        updates.push({
            _id: bucket.tiering.tiers[0].tier._id,
            mirrors: [{
                _id: system_store.new_system_store_id(),
                spread_pools: [pool._id]
            }]
        });
    }
    dbg.log0(`Updating ${buckets_with_internal_pool.length} buckets to use ${pool_name} as default resource`);
    await system_store.make_changes({
        update: {
            tiers: updates
        }
    });
}

// OB/OBC Related
async function claim_bucket(req) {
    dbg.log0('claim bucket', req.rpc_params);

    if (req.rpc_params.create_bucket) {
        try {
            validate_bucket_creation(req);
        } catch (err) {
            dbg.log0('claim_bucket failed validating bucket', err);
            throw err;
        }
        try {
            await server_rpc.client.bucket.create_bucket({
                name: req.rpc_params.name,
                tiering: req.rpc_params.tiering,
                bucket_claim: req.rpc_params.bucket_claim,
            }, {
                auth_token: req.auth_token
            });
        } catch (err) {
            dbg.log0('claim_bucket failed creating bucket', err);
            throw err;
        }
    }

    try {
        const internal_pool = pool_server.get_internal_mongo_pool(req.system);
        const response = await server_rpc.client.account.create_account({
            name: req.rpc_params.email,
            email: req.rpc_params.email,
            default_pool: internal_pool.name,
            has_login: false,
            s3_access: true,
            allow_bucket_creation: false,
            allowed_buckets: {
                full_permission: false,
                permission_list: [req.rpc_params.name],
            }
        }, {
            auth_token: req.auth_token
        });
        const ret = {
            access_keys: {
                access_key: response.access_keys[0].access_key.unwrap(),
                secret_key: response.access_keys[0].secret_key.unwrap()
            }
        };
        return ret;
    } catch (err) {
        dbg.log0('claim_bucket failed creating account', err);
        if (req.rpc_params.create_bucket) {
            await server_rpc.client.bucket.delete_bucket({
                name: req.rpc_params.name
            }, {
                auth_token: req.auth_token
            });
        }
    }
}

async function delete_claim(req) {
    dbg.log0('delete claim', req.rpc_params);

    await server_rpc.client.account.delete_account({
        email: req.rpc_params.email
    }, {
        auth_token: req.auth_token
    });

    if (req.rpc_params.delete_bucket) {
        await server_rpc.client.bucket.delete_bucket({
            name: req.rpc_params.name
        }, {
            auth_token: req.auth_token
        });
    }
}

// UTILS //////////////////////////////////////////////////////////

function validate_bucket_creation(req) {
    if (req.rpc_params.name.unwrap().length < 3 ||
        req.rpc_params.name.unwrap().length > 63 ||
        net.isIP(req.rpc_params.name.unwrap()) ||
        !VALID_BUCKET_NAME_REGEXP.test(req.rpc_params.name.unwrap())) {
        throw new RpcError('INVALID_BUCKET_NAME');
    }
    const bucket = req.system.buckets_by_name && req.system.buckets_by_name[req.rpc_params.name.unwrap()];

    if (bucket) {
        if (system_store.has_same_id(bucket.owner_account, req.account)) {
            throw new RpcError('BUCKET_ALREADY_OWNED_BY_YOU');
        } else {
            throw new RpcError('BUCKET_ALREADY_EXISTS');
        }
    }

    if (req.account.allow_bucket_creation === false) {
        throw new RpcError('UNAUTHORIZED', 'Not allowed to create new buckets');
    }
}

function validate_trigger_update(req, bucket, validated_trigger) {
    dbg.log0('validate_trigger_update: Chekcing new trigger is legal:', validated_trigger);
    let validate_function = true;
    _.forEach(bucket.lambda_triggers, trigger => {
        const is_same_trigger = String(trigger._id) === String(validated_trigger._id);
        const is_same_func =
            validated_trigger.func_name === trigger.func_name &&
            validated_trigger.func_version === trigger.func_version;
        if (is_same_trigger && is_same_func) validate_function = false; // if this is update and function didn't change - don't validate
        if (!is_same_trigger &&
            is_same_func &&
            trigger.event_name === validated_trigger.event_name &&
            trigger.object_prefix === validated_trigger.object_prefix &&
            trigger.object_suffix === validated_trigger.object_suffix) {
            throw new RpcError('TRIGGER_DUPLICATE', 'This trigger is the same as an existing one');
        }
    });
    if (!validate_function) return P.resolve(); // if update doesn't change function - no need to validate access
    return func_store.instance().read_func(bucket.system._id, validated_trigger.func_name, validated_trigger.func_version)
        .then(func => {
            const exec_account = system_store.data.get_by_id(func.exec_account);
            if (!auth_server.has_bucket_permission(bucket, exec_account)) {
                throw new RpcError('UNAUTHORIZED', 'No permission to access bucket');
            }
        });
}

function _inject_usage_to_cloud_bucket(target_name, endpoint, usage_list) {
    let res = {
        name: target_name
    };
    let using_target = usage_list.find(candidate_target => (target_name === candidate_target.target_name &&
        endpoint === candidate_target.endpoint));
    if (using_target) {
        res.used_by = {
            name: using_target.source_name,
            usage_type: using_target.usage_type
        };
    }
    return res;
}

function find_bucket(req, bucket_name = req.rpc_params.name) {
    var bucket = req.system.buckets_by_name && req.system.buckets_by_name[bucket_name.unwrap()];
    if (!bucket) {
        dbg.error('BUCKET NOT FOUND', bucket_name);
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + bucket_name);
    }
    req.check_s3_bucket_permission(bucket);
    return bucket;
}

function get_bucket_info({
    bucket,
    nodes_aggregate_pool,
    hosts_aggregate_pool,
    func_configs,
    bucket_stats,
}) {
    const tiering_pools_status = node_allocator.get_tiering_status(bucket.tiering);
    const tiering = tier_server.get_tiering_policy_info(
        bucket.tiering,
        tiering_pools_status,
        nodes_aggregate_pool,
        hosts_aggregate_pool
    );
    const bucket_last_update = _.get(bucket, 'storage_stats.last_update') || config.NOOBAA_EPOCH;
    const system_last_update = _.get(bucket, 'system.global.last_update') || config.NOOBAA_EPOCH;
    const last_update = Math.max(system_last_update, bucket_last_update);
    const info = {
        name: bucket.name,
        owner_account: {
            email: bucket.owner_account.email,
            id: bucket.owner_account._id,
        },
        namespace: bucket.namespace ? {
            write_resource: pool_server.get_namespace_resource_info(
                bucket.namespace.write_resource).name,
            read_resources: _.map(bucket.namespace.read_resources, rs => pool_server.get_namespace_resource_info(rs).name),
            caching: bucket.namespace.caching
        } : undefined,
        tiering: tiering,
        tag: bucket.tag ? bucket.tag : '',
        num_objects: {
            value: _.get(bucket, 'storage_stats.objects_count') || 0,
            last_update
        },
        writable: false,
        spillover: undefined,
        storage: undefined,
        data: undefined,
        usage_by_pool: {
            pools: [],
            last_update,
        },
        quota: undefined,
        stats: undefined,
        stats_by_type: [],
        mode: undefined,
        host_tolerance: undefined,
        node_tolerance: undefined,
        bucket_type: bucket.namespace ? 'NAMESPACE' : 'REGULAR',
        versioning: bucket.versioning,
        object_lock_configuration: config.WORM_ENABLED ? bucket.object_lock_configuration : undefined,
        tagging: bucket.tagging,
        encryption: bucket.encryption,
        bucket_claim: bucket.bucket_claim,
        website: bucket.website,
        policy: bucket.policy,
    };

    const metrics = _calc_metrics({ bucket, nodes_aggregate_pool, hosts_aggregate_pool, tiering_pools_status, info });
    _.mapKeys(_.get(bucket, 'storage_stats.pools') || {}, function(storage, pool_id) {
        const pool = system_store.data.get_by_id(pool_id);
        if (pool) {
            info.usage_by_pool.pools.push({
                pool_name: system_store.data.get_by_id(pool_id).name,
                storage: storage
            });
        }
    });

    if (!bucket.namespace) {
        info.policy_modes = {
            resiliency_status: calc_data_resiliency_status(metrics),
            quota_status: calc_quota_status(metrics),
        };
    }
    // calc_bucket_aggregated_mode(metrics);
    let ignore_quota = false;
    info.mode = bucket.namespace ?
        calc_namespace_mode() :
        calc_bucket_mode(tiering.tiers, metrics, ignore_quota);

    ignore_quota = true;
    info.tiering.mode = calc_bucket_mode(tiering.tiers, metrics, ignore_quota);

    info.triggers = _.map(bucket.lambda_triggers, trigger => {
        const ret_trigger = _.omit(trigger, '_id');
        ret_trigger.id = trigger._id.toString();
        const func = _.find(func_configs, func_config =>
            func_config.name === trigger.func_name &&
            func_config.version === trigger.func_version
        );
        const exec_account = system_store.get_account_by_email(func.exec_account);
        ret_trigger.permission_problem = !auth_server.has_bucket_permission(bucket, exec_account);
        return ret_trigger;
    });

    if (bucket_stats) {
        info.stats = {
            reads: bucket_stats.total_reads || 0,
            writes: bucket_stats.total_writes || 0,
            last_read: bucket_stats.last_read || -1,
            last_write: bucket_stats.last_write || -1,
        };
        // group stats by the first part of the content type and reduce
        const content_type_stats = _.get(bucket, 'storage_stats.stats_by_content_type', []);
        const size_by_content_type = _.keyBy(content_type_stats, 'content_type');
        const full_stats = bucket_stats.stats.map(stat => ({
            data_type: stat.content_type.split('/')[0],
            reads: stat.reads || 0,
            writes: stat.writes || 0,
            size: _.get(size_by_content_type[stat.content_type], 'size', 0),
            count: _.get(size_by_content_type[stat.content_type], 'count', 0),
        }));
        info.stats_by_type = _.map(_.groupBy(full_stats, 'data_type'), stats => stats.reduce((prev, curr) => ({
            data_type: prev.data_type,
            reads: prev.reads + curr.reads,
            writes: prev.writes + curr.writes,
            size: size_utils.sum_bigint_json(prev.size, curr.size),
            count: prev.count + curr.count,
        })));
    }

    return info;
}

function is_using_internal_storage(bucket, internal_pool) {
    const tiers = bucket.tiering.tiers;
    if (tiers.length !== 1) return false;

    const mirrors = tiers[0].tier.mirrors;
    if (mirrors.length !== 1) return false;

    const spread_pools = mirrors[0].spread_pools;
    if (spread_pools.length !== 1) return false;


    return String(spread_pools[0]._id) === String(internal_pool._id);
}

function _calc_metrics({
    bucket,
    nodes_aggregate_pool,
    hosts_aggregate_pool,
    tiering_pools_status,
    info
}) {
    const tiering_pools_used_agg = [0];
    let has_any_pool_configured = false;
    let has_enough_healthy_nodes_for_tiering = false;
    let has_enough_total_nodes_for_tiering = false;
    let any_rebuilds = false;
    const internal_pool = pool_server.get_internal_mongo_pool(bucket.system);

    const objects_aggregate = {
        size: (bucket.storage_stats && bucket.storage_stats.objects_size) || 0,
        count: (bucket.storage_stats && bucket.storage_stats.objects_count) || 0
    };
    let is_quota_exceeded = false;
    let is_quota_low = false;
    if (bucket.quota) {
        let quota_precent = system_utils.get_bucket_quota_usage_percent(bucket, bucket.quota);
        info.quota = _.omit(bucket.quota, 'value');
        let quota_free = size_utils.json_to_bigint(bucket.quota.value).minus(size_utils.json_to_bigint(objects_aggregate.size));
        if (quota_precent >= 100) {
            is_quota_exceeded = true;
        } else if (quota_precent >= 90) {
            is_quota_low = true;
        }
        if (quota_free.isNegative()) {
            quota_free = BigInteger.zero;
        }
    }
    let risky_tolerance = false;

    _.each(bucket.tiering.tiers, tier_and_order => {
        const tier = tier_and_order.tier;
        const tier_extra_info = tier_server.get_tier_extra_info(tier, tiering_pools_status, nodes_aggregate_pool, hosts_aggregate_pool);
        has_any_pool_configured = has_any_pool_configured || tier_extra_info.has_any_pool_configured;
        tiering_pools_used_agg.push(tier_extra_info.used_of_pools_in_tier || 0);

        const ccc = _.get(tier_and_order, 'tier.chunk_config.chunk_coder_config');
        const configured_failure_tolerance = ccc.parity_frags || ccc.replicas - 1;
        risky_tolerance = configured_failure_tolerance < 0;

        const mirrors_with_valid_pool = tier_extra_info.mirrors_with_valid_pool;
        const mirrors_with_enough_nodes = tier_extra_info.mirrors_with_enough_nodes;

        info.host_tolerance = Math.min(info.host_tolerance || Infinity,
            tier_extra_info.host_tolerance, configured_failure_tolerance);
        info.node_tolerance = Math.min(info.node_tolerance || Infinity,
            tier_extra_info.node_tolerance, configured_failure_tolerance);
        info.writable = mirrors_with_valid_pool > 0;
        if (tier_and_order.tier.mirrors.length > 0) {
            if (mirrors_with_valid_pool === tier_and_order.tier.mirrors.length) has_enough_healthy_nodes_for_tiering = true;
            if (mirrors_with_enough_nodes === tier_and_order.tier.mirrors.length) has_enough_total_nodes_for_tiering = true;
        }
    });

    const used_of_pools_in_policy = size_utils.json_to_bigint(size_utils.reduce_sum('blocks_size', tiering_pools_used_agg));
    const bucket_chunks_capacity = size_utils.json_to_bigint(_.get(bucket, 'storage_stats.chunks_capacity') || 0);
    const bucket_used = size_utils.json_to_bigint(_.get(bucket, 'storage_stats.blocks_size') || 0);
    const bucket_used_other = BigInteger.max(used_of_pools_in_policy.minus(bucket_used), BigInteger.zero);
    const bucket_free = size_utils.json_to_bigint(_.get(info, 'tiering.storage.free') || 0);

    let is_storage_low = false;
    let is_no_storage = false;
    const bucket_total = bucket_free.plus(bucket_used)
        .plus(bucket_used_other);

    const bucket_last_update = _.get(bucket, 'storage_stats.last_update') || config.NOOBAA_EPOCH;
    const system_last_update = _.get(bucket, 'system.global_last_update') || config.NOOBAA_EPOCH;
    const last_update = Math.max(system_last_update, bucket_last_update);

    info.storage = {
        values: size_utils.to_bigint_storage({
            used: bucket_used,
            used_other: bucket_used_other,
            total: bucket_total,
            free: bucket_free,
        }),
        last_update
    };

    const actual_free = size_utils.json_to_bigint(_.get(info, 'tiering.data.free') || 0);
    let available_for_upload = actual_free;

    if (bucket.quota) {
        let quota_free = size_utils.json_to_bigint(bucket.quota.value).minus(size_utils.json_to_bigint(objects_aggregate.size));
        available_for_upload = size_utils.size_min([
            size_utils.bigint_to_json(quota_free),
            size_utils.bigint_to_json(available_for_upload)
        ]);
    }

    if (bucket_free.isZero()) {
        is_no_storage = true;
    } else {
        let free_percent = bucket_free.multiply(100).divide(bucket_total);
        if (free_percent < 30) {
            is_storage_low = true;
        }
    }

    const tier_with_issues = _.filter(info.tiering.tiers, tier => tier.mode !== 'OPTIMAL').length;
    info.data = size_utils.to_bigint_storage({
        size: objects_aggregate.size,
        size_reduced: bucket_chunks_capacity,
        free: actual_free,
        available_for_upload,
        last_update,
    });

    return {
        is_using_internal: is_using_internal_storage(bucket, internal_pool),
        has_any_pool_configured,
        has_enough_healthy_nodes_for_tiering,
        has_enough_total_nodes_for_tiering,
        risky_tolerance,
        any_rebuilds,
        is_storage_low,
        is_no_storage,
        tier_with_issues,
        is_quota_enabled: Boolean(bucket.quota),
        is_quota_exceeded,
        is_quota_low
    };
}

function get_bucket_func_configs(req, bucket) {
    if (!bucket.lambda_triggers || !bucket.lambda_triggers.length) return;
    return P.map(bucket.lambda_triggers, trigger =>
        server_rpc.client.func.read_func({
            name: trigger.func_name,
            version: trigger.func_version
        }, {
            auth_token: req.auth_token
        })
        .then(func_info => func_info.config));
}

function calc_namespace_mode() {
    return 'OPTIMAL';
}

function calc_bucket_mode(tiers, metrics, ignore_quota) {
    const {
        NO_RESOURCES = 0,
            NOT_ENOUGH_RESOURCES = 0,
            NOT_ENOUGH_HEALTHY_RESOURCES = 0,
            INTERNAL_STORAGE_ISSUES = 0,
            NO_CAPACITY = 0,
            LOW_CAPACITY = 0
    } = _.countBy(tiers, t => t.mode);

    const issueCount =
        NO_RESOURCES +
        NOT_ENOUGH_RESOURCES +
        NOT_ENOUGH_HEALTHY_RESOURCES;

    return (NO_RESOURCES === tiers.length && 'NO_RESOURCES') ||
        (NOT_ENOUGH_RESOURCES === tiers.length && 'NOT_ENOUGH_RESOURCES') ||
        (NOT_ENOUGH_HEALTHY_RESOURCES === tiers.length && 'NOT_ENOUGH_HEALTHY_RESOURCES') ||
        (INTERNAL_STORAGE_ISSUES && 'NOT_ENOUGH_HEALTHY_RESOURCES') ||
        (NO_CAPACITY === tiers.length && 'NO_CAPACITY') ||
        (issueCount === tiers.length && 'ALL_TIERS_HAVE_ISSUES') ||
        (!ignore_quota && metrics.is_quota_enabled && metrics.is_quota_exceeded && 'EXCEEDING_QUOTA') ||
        (NO_RESOURCES && 'TIER_NO_RESOURCES') ||
        (NOT_ENOUGH_RESOURCES && 'TIER_NOT_ENOUGH_RESOURCES') ||
        (NOT_ENOUGH_HEALTHY_RESOURCES && 'TIER_NOT_ENOUGH_HEALTHY_RESOURCES') ||
        (NO_CAPACITY && 'TIER_NO_CAPACITY') ||
        (metrics.is_storage_low && 'LOW_CAPACITY') ||
        (LOW_CAPACITY && 'TIER_LOW_CAPACITY') ||
        (ignore_quota && return_bucket_issues_mode(metrics)) ||
        'OPTIMAL';
}

function return_bucket_issues_mode(metrics) {
    return (metrics.is_using_internal && 'NO_RESOURCES_INTERNAL') ||
        (metrics.is_quota_enabled && metrics.is_quota_low && 'APPROUCHING_QUOTA') ||
        (metrics.any_rebuilds && 'DATA_ACTIVITY');
}

function calc_data_resiliency_status(metrics) {
    if (!metrics.has_enough_total_nodes_for_tiering) {
        return 'NOT_ENOUGH_RESOURCES';
    }
    if (metrics.is_using_internal) {
        return 'POLICY_PARTIALLY_APPLIED';
    }
    if (metrics.risky_tolerance) {
        return 'RISKY_TOLERANCE';
    }
    if (metrics.any_rebuilds) {
        return 'DATA_ACTIVITY';
    }
    return 'OPTIMAL';
}

function calc_quota_status(metrics) {
    if (!metrics.is_quota_enabled) {
        return 'QUOTA_NOT_SET';
    }
    if (metrics.is_quota_low) {
        return 'APPROUCHING_QUOTA';
    }
    if (metrics.is_quota_exceeded) {
        return 'EXCEEDING_QUOTA';
    }
    return 'OPTIMAL';
}

function resolve_tiering_policy(req, policy_name) {
    var tiering_policy = req.system.tiering_policies_by_name[policy_name.unwrap()];
    if (!tiering_policy) {
        dbg.error('TIER POLICY NOT FOUND', policy_name);
        throw new RpcError('INVALID_BUCKET_STATE', 'Bucket tiering policy not found');
    }
    return tiering_policy;
}

function can_delete_bucket(system, bucket) {
    return P.resolve()
        .then(() => {
            if (bucket.namespace) return;
            return MDStore.instance().has_any_completed_objects_in_bucket(bucket._id)
                .then(has_objects => {
                    if (has_objects) {
                        return 'NOT_EMPTY';
                    }
                });
        });
}

async function list_undeletable_buckets() {
    return MDStore.instance().all_buckets_with_completed_objects();
}

async function get_object_lock_configuration(req) {
    const bucket = find_bucket(req);
    dbg.log0('get object lock configuration of bucket', req.rpc_params);

    if (!bucket.object_lock_configuration || bucket.object_lock_configuration.object_lock_enabled !== 'Enabled') {
        throw new RpcError('OBJECT_LOCK_CONFIGURATION_NOT_FOUND_ERROR');
    }
    return bucket.object_lock_configuration;
}

async function put_object_lock_configuration(req) {
    dbg.log0('add object lock configuration to bucket', req.rpc_params);
    const bucket = find_bucket(req);

    if (bucket.object_lock_configuration.object_lock_enabled !== 'Enabled') {
        throw new RpcError('INVALID_BUCKET_STATE');
    }
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                object_lock_configuration: req.rpc_params.object_lock_configuration
            }]
        }
    });
}

// EXPORTS
exports.new_bucket_defaults = new_bucket_defaults;
exports.get_bucket_info = get_bucket_info;
exports.can_delete_bucket = can_delete_bucket;
exports.list_undeletable_buckets = list_undeletable_buckets;
//Bucket Management
exports.create_bucket = create_bucket;
exports.read_bucket = read_bucket;
exports.update_bucket = update_bucket;
exports.delete_bucket = delete_bucket;
exports.delete_bucket_and_objects = delete_bucket_and_objects;
exports.delete_bucket_lifecycle = delete_bucket_lifecycle;
exports.set_bucket_lifecycle_configuration_rules = set_bucket_lifecycle_configuration_rules;
exports.get_bucket_lifecycle_configuration_rules = get_bucket_lifecycle_configuration_rules;
exports.read_bucket_sdk_info = read_bucket_sdk_info;
exports.list_buckets = list_buckets;
exports.update_buckets = update_buckets;
//exports.generate_bucket_access = generate_bucket_access;
exports.update_bucket_s3_access = update_bucket_s3_access;
//Temporary - TODO: move to new server
exports.get_cloud_buckets = get_cloud_buckets;
exports.export_bucket_bandwidth_usage = export_bucket_bandwidth_usage;
exports.get_bucket_throughput_usage = get_bucket_throughput_usage;
exports.get_objects_size_histogram = get_objects_size_histogram;
exports.get_buckets_stats_by_content_type = get_buckets_stats_by_content_type;
//Triggers
exports.add_bucket_lambda_trigger = add_bucket_lambda_trigger;
exports.update_bucket_lambda_trigger = update_bucket_lambda_trigger;
exports.delete_bucket_lambda_trigger = delete_bucket_lambda_trigger;
exports.check_for_lambda_permission_issue = check_for_lambda_permission_issue;
exports.delete_bucket_tagging = delete_bucket_tagging;
exports.put_bucket_tagging = put_bucket_tagging;
exports.get_bucket_tagging = get_bucket_tagging;
//OB/OBC
exports.claim_bucket = claim_bucket;
exports.delete_claim = delete_claim;

exports.delete_bucket_encryption = delete_bucket_encryption;
exports.put_bucket_encryption = put_bucket_encryption;
exports.get_bucket_encryption = get_bucket_encryption;
exports.delete_bucket_website = delete_bucket_website;
exports.put_bucket_website = put_bucket_website;
exports.get_bucket_website = get_bucket_website;
exports.delete_bucket_policy = delete_bucket_policy;
exports.put_bucket_policy = put_bucket_policy;
exports.get_bucket_policy = get_bucket_policy;

exports.update_all_buckets_default_pool = update_all_buckets_default_pool;

exports.get_object_lock_configuration = get_object_lock_configuration;
exports.put_object_lock_configuration = put_object_lock_configuration;

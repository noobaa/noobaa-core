/* Copyright (C) 2016 NooBaa */
/* eslint max-lines: ['error', 2500] */
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
const system_store = require('../system_services/system_store').get_instance();
const func_store = require('../func_services/func_store');
const replication_store = require('../system_services/replication_store');
const node_allocator = require('../node_services/node_allocator');
const azure_storage = require('../../util/new_azure_storage_wrap');
const usage_aggregator = require('../bg_services/usage_aggregator');
const chunk_config_utils = require('../utils/chunk_config_utils');
const NetStorage = require('../../util/NetStorageKit-Node-master/lib/netstorage');
const { OP_NAME_TO_ACTION } = require('../../endpoint/s3/s3_utils');
const path = require('path');
const KeysSemaphore = require('../../util/keys_semaphore');
const bucket_semaphore = new KeysSemaphore(1);
const Quota = require('../system_services/objects/quota');

const VALID_BUCKET_NAME_REGEXP =
    /^(([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/;

const EXTERNAL_BUCKET_LIST_TO = 30 * 1000; //30s

const trigger_properties = ['event_name', 'object_prefix', 'object_suffix'];
const qm_regex = /\?/g;
const ar_regex = /\*/g;

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
        } : undefined,
    };
}

/**
 *
 * CREATE_BUCKET
 *
 */
async function create_bucket(req) {
    // eslint-disable-next-line max-statements
    return bucket_semaphore.surround_key(String(req.rpc_params.name), async () => {
        req.load_auth();
        validate_bucket_creation(req);

        let tiering_policy;
        let should_create_underlying_storage = false;
        const changes = {
            insert: {},
            update: {}
        };

        const mongo_pool = pool_server.get_internal_mongo_pool(req.system);
        if (!mongo_pool) throw new RpcError('MONGO_POOL_NOT_FOUND');
        if (req.rpc_params.tiering) {
            tiering_policy = resolve_tiering_policy(req, req.rpc_params.tiering);
        } else if (req.system.namespace_resources_by_name && req.system.namespace_resources_by_name[req.account.default_resource.name]) {
            dbg.log0('creating bucket on default namespace resource');
            if (!req.account.nsfs_account_config || !req.account.nsfs_account_config.new_buckets_path) {
                throw new RpcError('MISSING_NSFS_ACCOUNT_CONFIGURATION');
            }
            const nsr = {
                resource: req.account.default_resource.name,
                path: path.join(req.account.nsfs_account_config.new_buckets_path, req.rpc_params.name.unwrap())
            };
            req.rpc_params.namespace = {
                read_resources: [nsr],
                write_resource: nsr
            };
            should_create_underlying_storage = true;

        } else if (_.isUndefined(req.rpc_params.namespace) || req.rpc_params.namespace.caching) {
            // we create dedicated tier and tiering policy for the new bucket
            // that uses the default_resource of that account
            const default_pool = req.account.default_resource;
            // Do not allow to create S3 buckets that are attached to mongo resource (internal storage)
            validate_pool_constraints({ mongo_pool, default_pool });
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

            tier_server.check_tier_exists(req, bucket_with_suffix);
            const tier = tier_server.new_tier_defaults(
                bucket_with_suffix,
                req.system._id,
                chunk_config._id,
                mirrors
            );

            tier_server.check_tiering_policy_exists(req, bucket_with_suffix);
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

        validate_non_nsfs_bucket_creation(req);
        validate_nsfs_bucket(req);

        let bucket = new_bucket_defaults(req.rpc_params.name, req.system._id,
            tiering_policy && tiering_policy._id, req.account._id, req.rpc_params.tag, req.rpc_params.lock_enabled);

        const bucket_m_key = system_store.master_key_manager.new_master_key({
            description: `master key of ${bucket._id} bucket`,
            master_key_id: req.system.master_key_id._id,
            cipher_type: req.system.master_key_id.cipher_type
        });
        bucket.master_key_id = bucket_m_key._id;

        if (req.rpc_params.namespace) {
            const read_resources = _.compact(req.rpc_params.namespace.read_resources
                .map(nsr => {
                    const res = req.system.namespace_resources_by_name && req.system.namespace_resources_by_name[nsr.resource];
                    return res && { resource: res._id, path: nsr.path };
                })
            );
            const wr_obj = req.rpc_params.namespace.write_resource && req.system.namespace_resources_by_name &&
                req.system.namespace_resources_by_name[req.rpc_params.namespace.write_resource.resource];
            const write_resource = wr_obj && { resource: wr_obj._id, path: req.rpc_params.namespace.write_resource.path };
            if (!write_resource) {
                dbg.log0('write resource was not provided, will create a readonly namespace bucket');
            }
            if (req.rpc_params.namespace.read_resources &&
                (!read_resources.length ||
                    (read_resources.length !== req.rpc_params.namespace.read_resources.length)
                )) {
                throw new RpcError('INVALID_READ_RESOURCES');
            }
            if (req.rpc_params.namespace.write_resource.resource && !write_resource) {
                throw new RpcError('INVALID_WRITE_RESOURCES');
            }

            const caching = req.rpc_params.namespace.caching && {
                ttl_ms: config.NAMESPACE_CACHING.DEFAULT_CACHE_TTL_MS,
                ...req.rpc_params.namespace.caching,
            };

            // reorder read resources so that the write resource is the first in the list
            const ordered_read_resources = write_resource ?
                [write_resource].concat(read_resources.filter(rr => rr.resource !== write_resource.resource)) : read_resources;

            bucket.namespace = {
                read_resources: ordered_read_resources,
                write_resource,
                caching,
                should_create_underlying_storage
            };
        }
        if (req.rpc_params.bucket_claim) {
            // TODO: Should implement validity checks
            bucket.bucket_claim = req.rpc_params.bucket_claim;
        }
        changes.insert.buckets = [bucket];
        changes.insert.master_keys = [bucket_m_key];

        Dispatcher.instance().activity({
            event: 'bucket.create',
            level: 'info',
            system: req.system._id,
            actor: req.account && req.account._id,
            bucket: bucket._id,
            desc: `${bucket.name.unwrap()} was created by ${req.account && req.account.email.unwrap()}`,
        });

        await system_store.make_changes(changes);
        req.load_auth();
        if (req.rpc_params.bucket_claim || req.rpc_params.namespace) {
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
    });
}

function validate_pool_constraints({ mongo_pool, default_pool }) {
    if (config.ALLOW_BUCKET_CREATE_ON_INTERNAL !== true) {
        if (!(mongo_pool && mongo_pool._id) || !(default_pool && default_pool._id)) throw new RpcError('SERVICE_UNAVAILABLE', 'Non existing pool');
        if (String(mongo_pool._id) === String(default_pool._id)) throw new RpcError('SERVICE_UNAVAILABLE', 'Not allowed to create new buckets on internal pool');
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
            const resource_regex = RegExp(`^${resource_bucket_part.replace(qm_regex, '.?').replace(ar_regex, '.*')}$`);
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
async function read_bucket(req) {
    const bucket_sdk_info = await read_bucket_sdk_info(req);
    return bucket_sdk_info.bucket_info;
}

async function read_bucket_sdk_info(req) {
    const bucket = find_bucket(req);
    var pools = [];

    _.forEach(bucket.tiering && bucket.tiering.tiers, tier_and_order => {
        _.forEach(tier_and_order.tier.mirrors, mirror_object => {
            pools = _.concat(pools, mirror_object.spread_pools);
        });
    });
    pools = _.compact(pools);
    let pool_names = pools.map(pool => pool.name);

    const system = req.system;

    const reply = {
        _id: bucket._id,
        name: bucket.name,
        website: bucket.website,
        s3_policy: bucket.s3_policy,
        active_triggers: _.map(
            _.filter(bucket.lambda_triggers, 'enabled'),
            trigger => _.pick(trigger, trigger_properties)
        ),
        system_owner: bucket.system.owner.email,
        bucket_owner: bucket.owner_account.email,
        bucket_info: await P.map_props({
                bucket,
                nodes_aggregate_pool: bucket.tiering && nodes_client.instance().aggregate_nodes_by_pool(pool_names, system._id),
                hosts_aggregate_pool: bucket.tiering && nodes_client.instance().aggregate_hosts_by_pool(null, system._id),
                // num_of_objects: MDStore.instance().count_objects_of_bucket(bucket._id),
                func_configs: get_bucket_func_configs(req, bucket),
                unused_refresh_tiering_alloc: bucket.tiering && node_allocator.refresh_tiering_alloc(bucket.tiering),
            })
            .then(get_bucket_info),
    };

    if (bucket.namespace) {
        reply.namespace = {
            write_resource: bucket.namespace.write_resource ? {
                resource: pool_server.get_namespace_resource_extended_info(
                    system.namespace_resources_by_name[bucket.namespace.write_resource.resource.name]),
                path: bucket.namespace.write_resource.path,
            } : undefined,
            read_resources: _.map(bucket.namespace.read_resources, rs =>
                ({ resource: pool_server.get_namespace_resource_extended_info(rs.resource), path: rs.path })
            ),
            caching: bucket.namespace.caching,
            should_create_underlying_storage: bucket.namespace.should_create_underlying_storage
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
    validate_nsfs_bucket(req);
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
    if (bucket.namespace && !bucket.namespace.write_resource.resource.nsfs_config) {
        throw new RpcError('BAD_REQUEST', 'Cannot set versioning on non nsfs namespace buckets');
    }

    single_bucket_update.versioning = update_request.versioning;
    changes.events.push(versioning_event);
}

function get_bucket_changes_namespace(req, bucket, update_request, single_bucket_update) {
    if (!bucket.namespace) throw new RpcError('CANNOT_CONVERT_BUCKET_TO_NAMESPACE_BUCKET');
    if (!update_request.namespace.read_resources.length) throw new RpcError('INVALID_READ_RESOURCES');

    const read_resources = _.compact(update_request.namespace.read_resources
        .map(nsr => {
            const res = req.system.namespace_resources_by_name && req.system.namespace_resources_by_name[nsr.resource];
            return res && { resource: res._id, path: nsr.path };
        }));
    if (!read_resources.length || (read_resources.length !== update_request.namespace.read_resources.length)) {
        throw new RpcError('INVALID_READ_RESOURCES');
    }
    _.set(single_bucket_update, 'namespace.read_resources', read_resources);
    const wr_obj = req.system.namespace_resources_by_name &&
        req.system.namespace_resources_by_name[update_request.namespace.write_resource.resource];
    const write_resource = wr_obj && { resource: wr_obj._id, path: update_request.namespace.write_resource.path };
    if (!write_resource) throw new RpcError('INVALID_WRITE_RESOURCES');
    _.set(single_bucket_update, 'namespace.write_resource', write_resource);
    // _.find in opposed to _.includes does a correct search for objects in array
    if (!_.find(update_request.namespace.read_resources, update_request.namespace.write_resource)) {
        throw new RpcError('INVALID_NAMESPACE_CONFIGURATION');
    }

    // reorder read resources so that the write resource is the first in the list
    const ordered_read_resources = [write_resource].concat(read_resources.filter(rr => rr.resource !== write_resource.resource));

    _.set(single_bucket_update, 'namespace.read_resources', ordered_read_resources);
    _.set(single_bucket_update, 'namespace.write_resource', write_resource);

    if (req.params.namespace.caching) {
        // If the update request contains a caching policy, set it to the bucket
        _.set(single_bucket_update, 'namespace.caching', req.params.namespace.caching);
    } else if (bucket.namespace.caching) {
        // If the update request does not contains a caching policy, but one was already set
        // for the bucket, prevent it from being overridden
        _.set(single_bucket_update, 'namespace.caching', bucket.namespace.caching);
    }
}

function get_bucket_changes_quota(req, bucket, quota_config, single_bucket_update, changes) {
    const quota_event = {
        event: 'bucket.quota',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        bucket: bucket._id,
    };

    const quota = new Quota(quota_config);
    if (quota.is_empty_quota()) {
        single_bucket_update.$unset = { quota: 1 };
        quota_event.desc = `Bucket quota was removed from ${bucket.name.unwrap()} by ${req.account && req.account.email.unwrap()}`;
    } else {
        if (!quota.is_valid_quota()) throw new RpcError('BAD_REQUEST', 'quota config values must be positive');

        quota.add_quota_alerts(system_store.data.systems[0]._id, bucket, changes.alerts);

        //Make event description
        const quota_size_raw_value = quota.get_quota_by_size();
        const quota_quantity_raw_data = quota.get_quota_by_quantity();
        quota_event.desc = `Quota of ${quota_size_raw_value > 0 ? size_utils.human_size(quota_size_raw_value) : 'unlimited'} size
        and ${quota_quantity_raw_data > 0 ? size_utils.human_size(quota_quantity_raw_data) : 'unlimited'} qunatity 
        was set on ${bucket.name.unwrap()} by ${req.account && req.account.email.unwrap()}`;

        single_bucket_update.quota = quota.get_config();
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
    return bucket_semaphore.surround_key(String(req.rpc_params.name), async () => {
        req.load_auth();
        var bucket = find_bucket(req);
        // TODO before deleting tier and tiering_policy need to check they are not in use
        let tiering_policy = bucket.tiering;
        const reason = await can_delete_bucket(bucket);
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
        const associated_buckets = tier_server.get_associated_buckets(tiering_policy)
            .filter(bucket_id => String(bucket_id) !== String(bucket._id));
        const tieringpolicies = [];
        const tiers = [];
        if (tiering_policy && _.isEmpty(associated_buckets)) {
            tieringpolicies.push(tiering_policy._id);
            tiers.push(..._.compact(_.map(tiering_policy.tiers, tier_and_order => {
                const associated_tiering_policies = tier_server.get_associated_tiering_policies(tier_and_order.tier)
                    .filter(policy_id => String(policy_id) !== String(tiering_policy._id));
                if (_.isEmpty(associated_tiering_policies)) {
                    return tier_and_order.tier._id;
                }
            })));
        }
        await system_store.make_changes({
            remove: {
                buckets: [bucket._id],
                tieringpolicies,
                tiers
            }
        });
        if (bucket.replication_policy_id) {
            // delete replication from replication collection
            await replication_store.instance().delete_replication_by_id(bucket.replication_policy_id);
        }

        await BucketStatsStore.instance().delete_stats({
            system: req.system._id,
            bucket: bucket._id
        });
    });
}

/**
 *
 * DELETE_BUCKET_LIFECYCLE
 *
 */
async function delete_bucket_lifecycle(req) {
    const bucket = find_bucket(req);
    try {
        await system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    $unset: {
                        lifecycle_configuration_rules: 1
                    }
                }]
            }
        });
        const desc_string = [];
        desc_string.push(`lifecycle configuration rules were removed for bucket ${bucket.name.unwrap()} by ${req.account && req.account.email.unwrap()}`);

        Dispatcher.instance().activity({
            event: 'bucket.delete_lifecycle_configuration_rules',
            level: 'info',
            system: req.system._id,
            actor: req.account && req.account._id,
            bucket: bucket._id,
            desc: desc_string.join('\n'),
        });
    } catch (err) {
        dbg.error('Error deleting lifecycle configuration rules', err, err.stack);
        throw err;
    }
}

/**
 *
 * LIST_BUCKETS
 *
 */
async function list_buckets(req) {
    var buckets_by_name = _.filter(
        req.system.buckets_by_name,
        bucket => req.has_s3_bucket_permission(bucket, "s3:listbucket") && !bucket.deleting
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
            return fs.promises.writeFile(inner_path, out_lines.join('\n'));
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
async function set_bucket_lifecycle_configuration_rules(req) {
    dbg.log0('set bucket lifecycle configuration rules', req.rpc_params);

    const bucket = find_bucket(req);

    const lifecycle_configuration_rules = req.rpc_params.rules;

    try {
        await system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    lifecycle_configuration_rules: lifecycle_configuration_rules
                }]
            }
        });
        const desc_string = [];
        desc_string.push(`${bucket.name.unwrap()} was updated with lifecycle configuration rules by ${req.account && req.account.email.unwrap()}`);

        Dispatcher.instance().activity({
            event: 'bucket.set_lifecycle_configuration_rules',
            level: 'info',
            system: req.system._id,
            actor: req.account && req.account._id,
            bucket: bucket._id,
            desc: desc_string.join('\n'),
        });
    } catch (err) {
        dbg.error('Error setting lifecycle configuration rules', err, err.stack);
        throw err;
    }
}

/**
 *
 * GET_BUCKET_LIFECYCLE_CONFIGURATION_RULES
 *
 */
function get_bucket_lifecycle_configuration_rules(req) {
    dbg.log0('get bucket lifecycle configuration rules', req.rpc_params);
    const bucket = find_bucket(req);
    return bucket.lifecycle_configuration_rules || [];
}

/**
 *
 * GET_CLOUD_BUCKETS
 *
 */
function get_cloud_buckets(req) {
    dbg.log0('get cloud buckets', req.rpc_params);
    return P.fcall(async function() {
            var connection = cloud_utils.find_cloud_connection(
                req.account,
                req.rpc_params.connection
            );
            if (connection.endpoint_type === 'AZURE') {
                const blob_svc = azure_storage.BlobServiceClient.fromConnectionString(
                    cloud_utils.get_azure_new_connection_string(connection));
                const used_cloud_buckets = cloud_utils.get_used_cloud_targets(['AZURE'],
                    system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources);
                return P.timeout(EXTERNAL_BUCKET_LIST_TO, (async function() {
                    const result = [];
                    for await (const response of blob_svc.listContainers().byPage({ maxPageSize: 100 })) {
                        if (response.containerItems) {
                            for (const container of response.containerItems) {
                                result.push(_inject_usage_to_cloud_bucket(container.name, connection.endpoint, used_cloud_buckets));
                            }
                        }
                    }
                    return result;
                }()));
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
                return P.timeout(EXTERNAL_BUCKET_LIST_TO, P.fromCallback(callback => {
                        ns.dir(connection.cp_code, callback);
                    }))
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
            } else { // else if AWS(s3-compatible/aws/sts-aws)/Flashblade/IBM_COS
                var access_key;
                var secret_key;
                if (connection.aws_sts_arn) {
                    const creds = await cloud_utils.generate_aws_sts_creds(connection, "get_cloud_buckets_session");
                    access_key = creds.accessKeyId;
                    secret_key = creds.secretAccessKey;
                    connection.sessionToken = creds.sessionToken;
                } else {
                    access_key = connection.access_key.unwrap();
                    secret_key = connection.secret_key.unwrap();
                }
                var s3 = new AWS.S3({
                    endpoint: connection.endpoint,
                    accessKeyId: access_key,
                    secretAccessKey: secret_key,
                    sessionToken: connection.sessionToken,
                    signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(connection.endpoint, connection.auth_method),
                    s3DisableBodySigning: cloud_utils.disable_s3_compatible_bodysigning(connection.endpoint),
                    httpOptions: {
                        agent: http_utils.get_unsecured_agent(connection.endpoint)
                    }
                });
                const used_cloud_buckets = cloud_utils.get_used_cloud_targets(['AWS', 'AWSSTS', 'AWS_STS', 'S3_COMPATIBLE', 'FLASHBLADE', 'IBM_COS'],
                    system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources);
                return P.timeout(EXTERNAL_BUCKET_LIST_TO, P.ninvoke(s3, 'listBuckets'))
                    .then(data => data.Buckets.map(bucket =>
                        _inject_usage_to_cloud_bucket(bucket.Name, connection.endpoint, used_cloud_buckets)
                    ));
            }
        })
        .catch(err => {
            if (err instanceof P.TimeoutError) {
                dbg.log0('failed reading (t/o) external buckets list', req.rpc_params);
            } else {
                dbg.error("get_cloud_buckets ERROR", err.stack || err);
            }
            throw err;
        });
}

/**
 *
 * ADD_BUCKET_LAMBDA_TRIGGER
 *
 */
async function add_bucket_lambda_trigger(req) {
    dbg.log0('add new bucket lambda trigger', req.rpc_params);
    const new_trigger = req.rpc_params;
    new_trigger.func_version = new_trigger.func_version || '$LATEST';
    const bucket = find_bucket(req, req.rpc_params.bucket_name);
    await validate_trigger_update(bucket, new_trigger);
    const trigger = _.omitBy({
        _id: system_store.new_system_store_id(),
        event_name: new_trigger.event_name,
        func_name: new_trigger.func_name,
        func_version: new_trigger.func_version,
        enabled: new_trigger.enabled !== false,
        object_prefix: new_trigger.object_prefix || undefined,
        object_suffix: new_trigger.object_suffix || undefined,
        attempts: new_trigger.attempts || undefined,
    }, _.isUndefined);
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                $push: { lambda_triggers: trigger },
            }]
        }
    });
}

/**
 *
 * DELETE_BUCKET_LAMBDA_TRIGGER
 *
 */
async function delete_bucket_lambda_trigger(req) {
    dbg.log0('delete bucket lambda trigger', req.rpc_params);
    const trigger_id = req.rpc_params.id;
    var bucket = find_bucket(req, req.rpc_params.bucket_name);
    const trigger = bucket.lambda_triggers.find(trig => trig._id.toString() === trigger_id);
    if (!trigger) {
        throw new RpcError('NO_SUCH_TRIGGER', 'This trigger does not exists: ' + trigger_id);
    }
    await system_store.make_changes({
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
    });
}

async function update_bucket_lambda_trigger(req) {
    dbg.log0('update bucket lambda trigger', req.rpc_params);
    const updates = _.pick(req.rpc_params, 'event_name', 'func_name', 'func_version', 'enabled', 'object_prefix', 'object_suffix', 'attempts');
    if (_.isEmpty(updates)) return;
    updates.func_version = updates.func_version || '$LATEST';
    var bucket = find_bucket(req, req.rpc_params.bucket_name);
    const trigger = _.find(bucket.lambda_triggers, trig => trig._id.toString() === req.rpc_params.id);
    if (!trigger) {
        throw new RpcError('NO_SUCH_TRIGGER', 'This trigger does not exists: ' + req.rpc_params._id);
    }
    const validate_trigger = { ...trigger, ...updates };
    await validate_trigger_update(bucket, validate_trigger);
    await system_store.make_changes({
        update: {
            buckets: [{
                $find: { _id: bucket._id, 'lambda_triggers._id': trigger._id },
                $set: _.mapKeys(updates, (value, key) => `lambda_triggers.$.${key}`)
            }]
        }
    });
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

function validate_nsfs_bucket(req) {
    // do not allow creation of 2 nsfs buckets on the same path - RPC 
    if (req.rpc_params.namespace && req.rpc_params.namespace.write_resource && req.system.namespace_resources_by_name) {
        const write_resource = req.system.namespace_resources_by_name[req.rpc_params.namespace.write_resource.resource];
        const bucket_nsfs_config = write_resource && write_resource.nsfs_config;
        if (bucket_nsfs_config) {

            const bucket_path = path.join(bucket_nsfs_config.fs_root_path, req.rpc_params.namespace.write_resource.path || '');

            const same_nsfs_path = req.system.buckets_by_name && Object.values(req.system.buckets_by_name).filter(buck =>
                buck.namespace && buck.namespace.write_resource.resource.nsfs_config &&
                path.join(buck.namespace.write_resource.resource.nsfs_config.fs_root_path, buck.namespace.write_resource.path || '') === bucket_path);

            if (same_nsfs_path && same_nsfs_path.length > 0) {
                throw new RpcError('BUCKET_ALREADY_EXISTS');
            }
        }
    }
}

function validate_trigger_update(bucket, validated_trigger) {
    dbg.log0('validate_trigger_update: Checking new trigger is legal:', validated_trigger);
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
            trigger.object_suffix === validated_trigger.object_suffix &&
            trigger.attempts === validated_trigger.attempts) {
            throw new RpcError('TRIGGER_DUPLICATE', 'This trigger is the same as an existing one');
        }
    });
    if (!validate_function) return P.resolve(); // if update doesn't change function - no need to validate access
    return func_store.instance().read_func(bucket.system._id, validated_trigger.func_name, validated_trigger.func_version);
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
    // Don't check for permissions - assume successful authn authz in endpoint
    return bucket;
}

function get_bucket_info({
    bucket,
    nodes_aggregate_pool,
    hosts_aggregate_pool,
    func_configs,
    bucket_stats = undefined,
    unused_refresh_tiering_alloc = undefined,
}) {
    const tiering_pools_status = node_allocator.get_tiering_status(bucket.tiering);
    const tiering = bucket.tiering && tier_server.get_tiering_policy_info(
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
        owner_account: bucket.owner_account && bucket.owner_account.email ? {
            email: bucket.owner_account.email,
            id: bucket.owner_account._id,
        } : undefined,
        namespace: bucket.namespace ? {
            write_resource: bucket.namespace.write_resource ? {
                resource: pool_server.get_namespace_resource_info(bucket.namespace.write_resource.resource).name,
                path: bucket.namespace.write_resource.path
            } : undefined,
            read_resources: _.map(bucket.namespace.read_resources, rs =>
                ({ resource: pool_server.get_namespace_resource_info(rs.resource).name, path: rs.path })
            ),
            should_create_underlying_storage: bucket.namespace.should_create_underlying_storage
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
        s3_policy: bucket.s3_policy,
        replication_policy_id: bucket.replication_policy_id,
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
    info.mode = calc_bucket_mode(tiering && tiering.tiers, metrics, ignore_quota, bucket.namespace);

    ignore_quota = true;
    if (info.tiering) {
        info.tiering.mode = calc_bucket_mode(tiering.tiers, metrics, ignore_quota);
    }

    info.triggers = _.map(bucket.lambda_triggers, trigger => {
        const ret_trigger = _.omit(trigger, '_id');
        ret_trigger.id = trigger._id.toString();
        ret_trigger.permission_problem = true;
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
    const tiers = bucket.tiering && bucket.tiering.tiers;
    if (!tiers || tiers.length !== 1) return false;

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
        const quota = new Quota(bucket.quota);
        info.quota = quota.get_config();
        const quota_exceeded = quota.is_quota_exceeded(bucket);
        is_quota_exceeded = quota_exceeded.is_quota_exceeded;
        is_quota_low = quota_exceeded.is_quota_low;
    }
    let risky_tolerance = false;

    _.each(bucket.tiering && bucket.tiering.tiers, tier_and_order => {
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

    const quota = new Quota(bucket.quota);
    let available_size_for_upload = quota.get_available_size_for_upload(actual_free, objects_aggregate.size);
    let available_quantity_for_upload = quota.get_available_quantity_for_upload(objects_aggregate.count);

    if (bucket_free.isZero()) {
        is_no_storage = true;
    } else {
        let free_percent = bucket_free.multiply(100).divide(bucket_total);
        if (free_percent < 30) {
            is_storage_low = true;
        }
    }

    const tier_with_issues = _.filter(info.tiering && info.tiering.tiers, tier => tier.mode !== 'OPTIMAL').length;
    info.data = size_utils.to_bigint_storage({
        size: objects_aggregate.size,
        size_reduced: bucket_chunks_capacity,
        free: actual_free,
        available_size_for_upload,
        available_quantity_for_upload,
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

function calc_namespace_bucket_mode(namespace_dict) {

    const rrs = namespace_dict.read_resources;
    const rr_modes = _.reduce(rrs, (acc, rr) => {
        const resource_mode = pool_server.calc_namespace_resource_mode(rr.resource);
        acc[resource_mode.toLowerCase()] += 1;
        return acc;
    }, { auth_failed: 0, storage_not_exist: 0, io_errors: 0, optimal: 0 });

    const mode = ((rr_modes.auth_failed + rr_modes.storage_not_exist === rrs.length) && 'NO_RESOURCES') ||
        ((rr_modes.auth_failed || rr_modes.storage_not_exist) && 'NOT_ENOUGH_HEALTHY_RESOURCES') ||
        'OPTIMAL';
    return mode;
}

function calc_bucket_mode(tiers, metrics, ignore_quota, bucket_namespace) {
    // for now we decided for cache buckets to return the mode with priority for the hub resource mode
    // if hub resource mode is optimal we will calculate the cache mode
    // in the future add cache bucket specific modes
    if (bucket_namespace) {
        const bucket_mode = calc_namespace_bucket_mode(bucket_namespace);
        if (!bucket_namespace.caching || (bucket_namespace.caching && bucket_mode !== 'OPTIMAL')) {
            return bucket_mode;
        }
    }
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

function can_delete_bucket(bucket) {
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

// account with nsfs_config.nsfs_only = true - should not be allowed to create non nsfs buckets
function validate_non_nsfs_bucket_creation(req) {
    const nsfs_account_config = req.account && req.account.nsfs_account_config;
    dbg.log0('validate_non_nsfs_bucket_create_allowed:', nsfs_account_config, req.rpc_params.namespace);
    if (!nsfs_account_config || !nsfs_account_config.nsfs_only) return;

    const nsr = req.rpc_params.namespace && req.rpc_params.namespace.write_resource && req.system.namespace_resources_by_name &&
        req.system.namespace_resources_by_name[req.rpc_params.namespace.write_resource.resource];

    dbg.log0('validate_non_nsfs_bucket_create_allowed: namespace_bucket_config', nsr && nsr.nsfs_config);

    // non namespace bucket || non namespace fs bucket
    if (!nsr || !nsr.nsfs_config) {
        throw new RpcError('UNAUTHORIZED');
    }
}

async function put_bucket_replication(req) {
    dbg.log0('put_bucket_replication:', req.rpc_params);
    const bucket = find_bucket(req);

    validate_replication(req);
    const replication_rules = normalize_replication(req);

    const bucket_replication_id = bucket.replication_policy_id;
    const replication_id = bucket_replication_id ?
        await replication_store.instance().update_replication(replication_rules, bucket_replication_id) :
        await replication_store.instance().insert_replication(replication_rules);

    console.log('update_bucket_replication: replication_id: ', replication_id);

    await system_store.make_changes({
        update: {
            buckets: [{ _id: bucket._id, replication_policy_id: replication_id }]
        }
    });
}

async function get_bucket_replication(req) {
    dbg.log0('get_bucket_replication:', req.rpc_params);
    const bucket = find_bucket(req);

    const replication_id = bucket.replication_policy_id;
    if (!replication_id) throw new RpcError('NO_REPLICATION_ON_BUCKET');

    const replication = await replication_store.instance().get_replication_by_id(replication_id);
    const bucket_names_replication = _.map(replication, rule => {
        let named_rule = { ...rule, destination_bucket: system_store.data.get_by_id(rule.destination_bucket).name };
        delete named_rule.rule_status;
        return named_rule;
    });

    const res = {
        rules: bucket_names_replication
    };
    if (replication.aws_log_replication_info) {
        res.log_replication_info.logs_location = replication.aws_log_replication_info.logs_location;
    }

    return res;
}

async function delete_bucket_replication(req) {
    dbg.log0('delete_bucket_replication:', req.rpc_params);
    const bucket = find_bucket(req);
    const replication_id = bucket.replication_policy_id;
    if (!replication_id) return;
    await system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                $unset: { replication_policy_id: 1 }
            }]
        }
    });

    // delete replication from replication collection
    await replication_store.instance().delete_replication_by_id(replication_id);
}

function validate_replication(req) {
    const replication_rules = req.rpc_params.replication_policy.rules;
    // num of rules in configuration must be in defined limits
    if (replication_rules.length > config.BUCKET_REPLICATION_MAX_RULES ||
        replication_rules.length < 1) throw new RpcError('INVALID_REPLICATION_POLICY', 'Number of rules is invalid');

    let rule_ids = [];
    let pref_by_dst_bucket = {};

    for (const rule of replication_rules) {
        const { destination_bucket, filter, rule_id } = rule;
        const dst_bucket = req.system.buckets_by_name && req.system.buckets_by_name[destination_bucket.unwrap()];
        // rule's destination bucket must exist and not equal to the replicated bucket
        if (req.rpc_params.name.unwrap() === destination_bucket.unwrap() || !dst_bucket) {
            throw new RpcError('INVALID_REPLICATION_POLICY', `Rule ${rule_id} destination bucket is invalid`);
        }

        rule_ids.push(rule_id);
        pref_by_dst_bucket[destination_bucket] = pref_by_dst_bucket[destination_bucket] || [];
        pref_by_dst_bucket[destination_bucket].push((filter && filter.prefix) || '');
    }

    // all rule_ids must be different
    if (new Set(rule_ids).size < replication_rules.length) throw new RpcError('INVALID_REPLICATION_POLICY', 'All rule ids must be unique');

    // num of different destination buckets in configuration must be in defined limits
    if (Object.keys(pref_by_dst_bucket).length > config.BUCKET_REPLICATION_MAX_DST_BUCKETS) {
        throw new RpcError('INVALID_REPLICATION_POLICY', 'Number of unique destination buckets is invalid');
    }
    // all prefixes of same destination bucket must not be a prefix of another prefix.
    for (const dst in pref_by_dst_bucket) {
        if (pref_by_dst_bucket[dst].length > 1) {
            const ordered_prefixes = _.orderBy(pref_by_dst_bucket[dst]);
            for (let i = 0; i < ordered_prefixes.length - 1; i++) {
                if (ordered_prefixes[i + 1].startsWith(ordered_prefixes[i])) {
                    throw new RpcError('INVALID_REPLICATION_POLICY', 'All prefixes of same destination bucket must not be a prefix of another prefix');
                }
            }
        }
    }
}

function normalize_replication(req) {
    const replication_rules = req.rpc_params.replication_policy.rules;

    const validated_replication_rules = replication_rules.map(rule => {
        const { destination_bucket } = rule;
        const dst_bucket = req.system.buckets_by_name && req.system.buckets_by_name[destination_bucket.unwrap()];
        return { ...rule, destination_bucket: dst_bucket._id };
    });


    let { log_replication_info } = req.rpc_params.replication_policy;
    if (log_replication_info && !log_replication_info.logs_location.logs_bucket) {
        const logs_bucket = find_bucket(req);
        const logs_bucket_info = get_bucket_info({ bucket: logs_bucket });
        log_replication_info.logs_location.logs_bucket = logs_bucket_info.namespace.write_resource.resource.connection.target_bucket;
    }

    const validated_replication = {
        rules: validated_replication_rules,
        aws_log_replication_info: log_replication_info
    };


    return validated_replication;
}

// EXPORTS
exports.new_bucket_defaults = new_bucket_defaults;
exports.get_bucket_info = get_bucket_info;
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

exports.put_bucket_replication = put_bucket_replication;
exports.get_bucket_replication = get_bucket_replication;
exports.delete_bucket_replication = delete_bucket_replication;
exports.validate_replication = validate_replication;

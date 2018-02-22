/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const net = require('net');
const fs = require('fs');
const url = require('url');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
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
const system_server = require('../system_services/system_server');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');
const system_utils = require('../utils/system_utils');
const azure_storage = require('../../util/azure_storage_wrap');
const usage_aggregator = require('../bg_services/usage_aggregator');
const cloud_sync_server = require('./cloud_sync_server');
const chunk_config_utils = require('../utils/chunk_config_utils');
const NetStorage = require('../../util/NetStorageKit-Node-master/lib/netstorage');

const VALID_BUCKET_NAME_REGEXP =
    /^(([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/;

const EXTERNAL_BUCKET_LIST_TO = 30 * 1000; //30s

function new_bucket_defaults(name, system_id, tiering_policy_id, tag) {
    let now = Date.now();
    return {
        _id: system_store.generate_id(),
        name: name,
        tag: js_utils.default_value(tag, ''),
        system: system_id,
        tiering: tiering_policy_id,
        storage_stats: {
            chunks_capacity: 0,
            blocks_size: 0,
            pools: {},
            objects_size: 0,
            objects_count: 0,
            objects_hist: [],
            last_update: now - (2 * config.MD_GRACE_IN_MILLISECONDS)
        },
        stats: {
            reads: 0,
            writes: 0,
        }
    };
}

/**
 *
 * CREATE_BUCKET
 *
 */
function create_bucket(req) {
    if (req.rpc_params.name.length < 3 ||
        req.rpc_params.name.length > 63 ||
        net.isIP(req.rpc_params.name) ||
        !VALID_BUCKET_NAME_REGEXP.test(req.rpc_params.name)) {
        throw new RpcError('INVALID_BUCKET_NAME');
    }
    if (req.system.buckets_by_name[req.rpc_params.name]) {
        throw new RpcError('BUCKET_ALREADY_EXISTS');
    }
    let tiering_policy;
    const changes = {
        insert: {},
        update: {}
    };

    const mongo_pool = pool_server.get_internal_mongo_pool(req.system);
    if (!mongo_pool) throw new RpcError('MONGO_POOL_NOT_FOUND');
    const internal_storage_tier = tier_server.get_internal_storage_tier(req.system);
    if (!internal_storage_tier) throw new RpcError('INTERNAL_TIER_NOT_FOUND');

    if (req.rpc_params.tiering) {
        tiering_policy = resolve_tiering_policy(req, req.rpc_params.tiering);
        changes.update.tieringpolicies = [{
            _id: tiering_policy._id,
            $push: {
                tiers: {
                    tier: internal_storage_tier._id,
                    order: 1,
                    spillover: true,
                    disabled: true
                }
            }
        }];
    } else {
        // we create dedicated tier and tiering policy for the new bucket
        // that uses the default_pool of that account
        const default_pool = req.account.default_pool;
        const chunk_config = chunk_config_utils.resolve_chunk_config(
            req.rpc_params.chunk_coder_config, req.account, req.system);
        if (!chunk_config._id) {
            chunk_config._id = system_store.generate_id();
            changes.insert.chunk_configs = [chunk_config];
        }
        const bucket_with_suffix = req.rpc_params.name + '#' + Date.now().toString(36);
        const mirrors = [{
            _id: system_store.generate_id(),
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
            }, {
                tier: internal_storage_tier._id,
                order: 1,
                spillover: true,
                disabled: true
            }]
        );

        changes.insert.tieringpolicies = [tiering_policy];
        changes.insert.tiers = [tier];
    }

    const bucket = new_bucket_defaults(
        req.rpc_params.name,
        req.system._id,
        tiering_policy._id,
        req.rpc_params.tag);

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

        // reorder read resources so that the write resource is the first in the list
        const ordered_read_resources = [write_resource].concat(read_resources.filter(resource => resource !== write_resource));

        bucket.namespace = {
            read_resources: ordered_read_resources,
            write_resource
        };
    }

    changes.insert.buckets = [bucket];
    Dispatcher.instance().activity({
        event: 'bucket.create',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        bucket: bucket._id,
        desc: `${bucket.name} was created by ${req.account && req.account.email}`,
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

    return system_store.make_changes(changes)
        .then(() => {
            req.load_auth();
            let created_bucket = find_bucket(req);
            return get_bucket_info(created_bucket);
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
    return P.join(
            nodes_client.instance().aggregate_nodes_by_pool(pool_names, req.system._id),
            nodes_client.instance().aggregate_data_free_by_tier(
                bucket.tiering.tiers.map(tiers_object => String(tiers_object.tier._id)), req.system._id),
            MDStore.instance().count_objects_of_bucket(bucket._id),
            cloud_sync_server.get_cloud_sync(req, bucket),
            node_allocator.refresh_tiering_alloc(bucket.tiering),
            nodes_client.instance().aggregate_hosts_by_pool(null, req.system._id)
        )
        .spread((nodes_aggregate_pool, aggregate_data_free_by_tier, num_of_objects, cloud_sync_policy, hosts_aggregate_pool) => get_bucket_info(bucket, nodes_aggregate_pool, hosts_aggregate_pool, aggregate_data_free_by_tier,
            num_of_objects, cloud_sync_policy));
}

function get_bucket_namespaces(req) {
    var bucket = find_bucket(req);
    const system = req.system;

    return P.resolve()
        .then(() => {
            if (bucket.namespace) {
                return {
                    name: bucket.name,
                    namespace: {
                        write_resource: pool_server.get_namespace_resource_extended_info(
                            system.namespace_resources_by_name[bucket.namespace.write_resource.name]
                        ),
                        read_resources: _.map(bucket.namespace.read_resources, rs => pool_server.get_namespace_resource_extended_info(rs))
                    },
                    proxy: system.phone_home_proxy_address
                };
            } else {
                return read_bucket(req);
            }
        });
}

/**
 *
 * UPDATE_BUCKET
 *
 */
function update_bucket(req) {
    const new_req = Object.assign({}, req, { rpc_params: [req.rpc_params] });
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
    const spillover_sent = !_.isUndefined(update_request.use_internal_spillover);

    let single_bucket_update = {
        _id: bucket._id
    };
    changes.updates.buckets = [single_bucket_update];

    if (update_request.namespace) {
        if (!bucket.namespace) {
            throw new RpcError('CANNOT_CONVERT_BUCKET_TO_NAMESPACE_BUCKET');
        }

        if (!update_request.namespace.read_resources.length) {
            throw new RpcError('INVALID_READ_RESOURCES');
        }

        const read_resources = _.compact(update_request.namespace.read_resources
            .map(ns_name => req.system.namespace_resources_by_name[ns_name] && req.system.namespace_resources_by_name[ns_name]._id));
        if (!read_resources.length || (read_resources.length !== update_request.namespace.read_resources.length)) {
            throw new RpcError('INVALID_READ_RESOURCES');
        }
        _.set(single_bucket_update, 'namespace.read_resources', read_resources);
        const wr_obj = req.system.namespace_resources_by_name[update_request.namespace.write_resource];
        const write_resource = wr_obj && wr_obj._id;
        if (!write_resource) {
            throw new RpcError('INVALID_WRITE_RESOURCES');
        }
        _.set(single_bucket_update, 'namespace.write_resource', write_resource);
        if (!_.includes(update_request.namespace.read_resources, update_request.namespace.write_resource)) {
            throw new RpcError('INVALID_NAMESPACE_CONFIGURATION');
        }


        // reorder read resources so that the write resource is the first in the list
        const ordered_read_resources = [write_resource].concat(read_resources.filter(resource => resource !== write_resource));

        _.set(single_bucket_update, 'namespace.read_resources', ordered_read_resources);
        _.set(single_bucket_update, 'namespace.write_resource', write_resource);
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
    if (!_.isUndefined(quota)) {

        const quota_event = {
            event: 'bucket.quota',
            level: 'info',
            system: req.system._id,
            actor: req.account && req.account._id,
            bucket: bucket._id,
        };

        if (quota === null) {
            single_bucket_update.$unset = {
                quota: 1
            };
            quota_event.desc = `Bucket quota was removed from ${bucket.name} by ${req.account && req.account.email}`;
        } else {
            if (quota.size <= 0) {
                throw new RpcError('BAD_REQUEST', 'quota size must be positive');
            }
            single_bucket_update.quota = quota;
            quota.value = size_utils.size_unit_to_bigint(quota.size, quota.unit).toJSON();
            let used_percent = system_utils.get_bucket_quota_usage_percent(bucket, quota);
            if (used_percent >= 100) {
                changes.alerts.push({
                    sev: 'MAJOR',
                    sysid: system_store.data.systems[0]._id,
                    alert: `Bucket ${bucket.name} exceeded its configured quota of ${
                        size_utils.human_size(quota.value)
                    }, uploads to this bucket will be denied`,
                    rule: Dispatcher.rules.once_daily
                });
                dbg.warn(`the bucket ${bucket.name} used capacity is more than the updated quota. uploads will be denied`);
            } else if (used_percent >= 90) {
                changes.alerts.push({
                    sev: 'INFO',
                    sysid: system_store.data.systems[0]._id,
                    alert: `Bucket ${bucket.name} exceeded 90% of its configured quota of ${size_utils.human_size(quota.value)}`,
                    rule: Dispatcher.rules.once_daily
                });
            }
            quota_event.desc = `Quota of ${size_utils.human_size(quota.value)} was set on ${bucket.name} by ${req.account && req.account.email}`;
        }
        changes.events.push(quota_event);

    }
    if (spillover_sent) {
        const tiering = tiering_policy || bucket.tiering;
        let spillover_tier = tiering.tiers.find(tier_and_order => tier_and_order.spillover);
        if (!spillover_tier) {
            const internal_mongo_pool = pool_server.get_internal_mongo_pool(req.system);
            if (!internal_mongo_pool) throw new RpcError('INTERNAL POOL NOT FOUND');
            spillover_tier = tier_server.get_internal_storage_tier(req.system);
            if (!spillover_tier) {
                spillover_tier = system_server.create_internal_tier(req.system, internal_mongo_pool);
                changes.inserts.tiers = changes.inserts.tiers || [];
                changes.inserts.tiers.push(spillover_tier);
            }
            tiering.tiers.push({
                tier: spillover_tier,
                order: 1,
                spillover: true,
                disabled: !update_request.use_internal_spillover
            });
        }
        spillover_tier.disabled = !update_request.use_internal_spillover;
        changes.updates.tieringpolicies = changes.updates.tieringpolicies || [];
        changes.updates.tieringpolicies.push({
            _id: tiering._id,
            tiers: tiering.tiers.map(tier_and_order => ({
                tier: tier_and_order.tier._id,
                order: tier_and_order.order,
                spillover: tier_and_order.spillover,
                disabled: tier_and_order.disabled
            }))
        });

        let desc;
        if (update_request.use_internal_spillover) {
            desc = `Bucket ${bucket.name} spillover was turned off by ${req.account && req.account.email}`;
        } else {
            desc = `Bucket ${bucket.name} spillover was turned on by ${req.account && req.account.email}`;
        }
        changes.events.push({
            event: 'bucket.spillover',
            level: 'info',
            system: req.system._id,
            actor: req.account && req.account._id,
            bucket: bucket._id,
            desc
        });
    }
    return changes;
}



/**
 *
 * GET_BUCKET_UPDATE
 *
 */
function update_buckets(req) {
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
        const { updates, inserts, events, alerts } = get_bucket_changes(req, update_request, bucket, tiering_policy);
        _.mergeWith(insert_changes, inserts, (existing_inserts, new_inserts) => (existing_inserts || []).concat(new_inserts));
        _.mergeWith(update_changes, updates, (existing_inserts, new_inserts) => (existing_inserts || []).concat(new_inserts));
        update_events = update_events.concat(events);
        update_alerts = update_alerts.concat(alerts);
    }

    return system_store.make_changes({
            insert: insert_changes,
            update: update_changes
        })
        .then(() => {
            P.map(update_events, event => Dispatcher.instance().activity(event));
            P.map(update_alerts, alert => Dispatcher.instance().alert(alert.sev, alert.sysid, alert.alert, alert.rule));
        });
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
                _.each(added_accounts, acc => desc_string.push(acc.email));
            }
            if (removed_accounts.length > 0) {
                desc_string.push('Removed accounts:');
                _.each(removed_accounts, acc => desc_string.push(acc.email));
            }

            Dispatcher.instance().activity({
                event: 'bucket.s3_access_updated',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
        })
        .return();
}


/**
 *
 * DELETE_BUCKET
 *
 */
function delete_bucket(req) {
    var bucket = find_bucket(req);
    // TODO before deleting tier and tiering_policy need to check they are not in use
    let tiering_policy = bucket.tiering;
    return can_delete_bucket(req.system, bucket)
        .then(reason => {
            if (reason) {
                throw new RpcError(reason, 'Cannot delete bucket');
            }
            Dispatcher.instance().activity({
                event: 'bucket.delete',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: `${bucket.name} was deleted by ${req.account && req.account.email}`,
            });
            return system_store.make_changes({
                remove: {
                    buckets: [bucket._id],
                    tieringpolicies: [tiering_policy._id],
                    tiers: _.compact(_.map(tiering_policy.tiers, tier_and_order => {
                        // We should not delete the spillover tiers/pools (internal currently)
                        // They will be assigned to tiering policies of other buckets
                        // So there they wouldn't be deleted, but I add this return just in case
                        // Something went to as planned
                        if (tier_and_order.spillover) return;
                        const associated_tiering_policies = tier_server.get_associated_tiering_policies(tier_and_order.tier)
                            .filter(policy_id => String(policy_id) !== String(tiering_policy._id));
                        if (_.isEmpty(associated_tiering_policies)) {
                            return tier_and_order.tier._id;
                        }
                    }))
                }
            });
        })
        .then(() => server_rpc.client.cloud_sync.refresh_policy({
            bucket_id: bucket._id.toString(),
            system_id: req.system._id.toString()
        }, {
            auth_token: req.auth_token
        }))
        .then(res => {
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

            return system_store.make_changes({
                    update: {
                        accounts: accounts_update
                    }
                })
                .return(res);
        })
        .return();
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
            desc_string.push(`lifecycle configuration rules were removed for bucket ${bucket.name} by ${req.account && req.account.email}`);

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
        })
        .return();
}

/**
 *
 * LIST_BUCKETS
 *
 */
function list_buckets(req) {
    var buckets_by_name = _.filter(
        req.system.buckets_by_name,
        bucket => req.has_bucket_permission(bucket)
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
        .replace(new RegExp('/', 'g'), '-');
    const till_str = (new Date(till)).toLocaleDateString()
        .replace(new RegExp('/', 'g'), '-');
    const file_name = `${name}_usage_${since_str}_to_${till_str}.csv`;
    const out_path = `/public/${file_name}`;
    const inner_path = `${process.cwd()}/build${out_path}`;
    return fs_utils.file_delete(inner_path)
        .then(() => fs_utils.create_path(`${process.cwd()}/build/public`))
        .then(() => usage_aggregator.get_daily_reports_for_bucket({ bucket: bucket._id, since, till }))
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
            desc_string.push(`${bucket.name} was updated with lifecycle configuration rules by ${req.account && req.account.email}`);

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
        })
        .return();
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
    const system = req.system;
    const proxy = system.phone_home_proxy_address;
    return P.fcall(function() {
            var connection = cloud_utils.find_cloud_connection(
                req.account,
                req.rpc_params.connection
            );
            if (connection.endpoint_type === 'AZURE') {
                let blob_svc = azure_storage.createBlobService(cloud_utils.get_azure_connection_string(connection));
                blob_svc.setProxy(proxy ? url.parse(proxy) : null);
                let used_cloud_buckets = cloud_utils.get_used_cloud_targets('AZURE',
                    system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources);
                return P.fromCallback(callback => blob_svc.listContainersSegmented(null, { maxResults: 100 }, callback))
                    .timeout(EXTERNAL_BUCKET_LIST_TO)
                    .then(data => data.entries.map(entry => _inject_usage_to_cloud_bucket(entry.name, connection.endpoint, used_cloud_buckets)));
            } else if (connection.endpoint_type === 'NET_STORAGE') {
                let used_cloud_buckets = cloud_utils.get_used_cloud_targets('NET_STORAGE',
                    system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources);

                const ns = new NetStorage({
                    hostname: connection.endpoint,
                    keyName: connection.access_key,
                    key: connection.secret_key,
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
            } //else if AWS
            let used_cloud_buckets = cloud_utils.get_used_cloud_targets('AWS',
                system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources);
            var s3 = new AWS.S3({
                endpoint: connection.endpoint,
                accessKeyId: connection.access_key,
                secretAccessKey: connection.secret_key,
                signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(connection.endpoint),
                s3DisableBodySigning: cloud_utils.disable_s3_compatible_bodysigning(connection.endpoint),
                httpOptions: {
                    agent: http_utils.get_unsecured_http_agent(connection.endpoint, proxy)
                }
            });
            return P.ninvoke(s3, "listBuckets")
                .timeout(EXTERNAL_BUCKET_LIST_TO)
                .then(data => data.Buckets.map(bucket => _inject_usage_to_cloud_bucket(bucket.Name, connection.endpoint, used_cloud_buckets)));
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


// UTILS //////////////////////////////////////////////////////////


function find_bucket(req, bucket_name = req.rpc_params.name) {
    var bucket = req.system.buckets_by_name[bucket_name];
    if (!bucket) {
        dbg.error('BUCKET NOT FOUND', bucket_name);
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + bucket_name);
    }
    req.check_bucket_permission(bucket);
    return bucket;
}

function get_bucket_info(bucket, nodes_aggregate_pool, hosts_aggregate_pool, aggregate_data_free_by_tier,
    num_of_objects, cloud_sync_policy) {
    const info = {
        name: bucket.name,
        namespace: bucket.namespace ? {
            write_resource: pool_server.get_namespace_resource_info(
                bucket.namespace.write_resource).name,
            read_resources: _.map(bucket.namespace.read_resources, rs => pool_server.get_namespace_resource_info(rs).name)
        } : undefined,
        tiering: tier_server.get_tiering_policy_info(bucket.tiering, nodes_aggregate_pool, aggregate_data_free_by_tier),
        tag: bucket.tag ? bucket.tag : '',
        num_objects: num_of_objects || 0,
        writable: false,
        spillover_enabled: false,
        storage: undefined,
        data: undefined,
        usage_by_pool: undefined,
        quota: undefined,
        stats: undefined,
        cloud_sync: undefined,
        mode: undefined,
        bucket_type: bucket.namespace ? 'NAMESPACE' : 'REGULAR'
    };


    const tiering_pools_status = node_allocator.get_tiering_status(bucket.tiering);
    const tiering_pools_used_agg = [0];
    let spillover_allowed_in_policy = false;
    let spillover_tier_in_policy;
    let has_any_pool_configured = false;
    let has_enough_healthy_nodes_for_tiering = false;
    let has_ehough_total_nodes_for_tiering = false;

    _.each(bucket.tiering.tiers, tier_and_order => {
        if (tier_and_order.spillover) {
            if (tier_and_order.disabled) {
                return;
            } else {
                spillover_allowed_in_policy = true;
                spillover_tier_in_policy = tier_and_order.tier;
            }
        }
        const ccc = _.get(tier_and_order, 'tier.chunk_config.chunk_coder_config');
        const required_valid_nodes = ccc ? (ccc.data_frags + ccc.parity_frags) * ccc.replicas : config.NODES_MIN_COUNT;
        let mirrors_with_valid_pool = 0;
        let mirrors_with_enough_nodes = 0;
        tier_and_order.tier.mirrors.forEach(mirror_object => {
            let num_valid_nodes = 0;
            let num_nodes_in_mirror_group = 0;
            let has_internal_or_cloud_pool = false;
            let has_valid_pool = false;
            _.compact((mirror_object.spread_pools || []).map(pool => {
                    has_any_pool_configured = has_any_pool_configured || !tier_and_order.spillover;
                    const spread_pool = system_store.data.pools.find(pool_rec => String(pool_rec._id) === String(pool._id));
                    tiering_pools_used_agg.push(_.get(spread_pool, 'storage_stats.blocks_size') || 0);
                    return _.extend({ pool_id: pool._id }, tiering_pools_status[tier_and_order.tier._id].pools[pool._id]);
                }))
                .forEach(pool_status => {
                    const pool_num_nodes = _.get(nodes_aggregate_pool, `groups.${pool_status.pool_id}.nodes.storage_count`) || 0;
                    num_nodes_in_mirror_group += pool_num_nodes;
                    num_valid_nodes += (pool_status.num_nodes || 0);
                    has_valid_pool = has_valid_pool || pool_status.valid_for_allocation;
                    has_internal_or_cloud_pool = has_internal_or_cloud_pool || (pool_status.resource_type !== 'HOSTS');
                });
            // let valid = ;
            if (has_valid_pool || ((num_valid_nodes || 0) >= required_valid_nodes)) mirrors_with_valid_pool += 1;
            if (num_nodes_in_mirror_group >= required_valid_nodes || has_internal_or_cloud_pool) mirrors_with_enough_nodes += 1;
            // return valid;
            const exitsting_minimum = _.isUndefined(info.num_of_nodes) ? Number.MAX_SAFE_INTEGER : info.num_of_nodes;
            const num_valid_nodes_for_minimum = _.isUndefined(num_valid_nodes) ? Number.MAX_SAFE_INTEGER : num_valid_nodes;
            const potential_new_minimum = has_internal_or_cloud_pool ? Number.MAX_SAFE_INTEGER : num_valid_nodes_for_minimum;
            info.num_of_nodes = Math.min(exitsting_minimum, potential_new_minimum);
        });
        info.num_of_nodes = info.num_of_nodes || 0;
        info.writable = mirrors_with_valid_pool > 0;
        if (!tier_and_order.spillover && tier_and_order.tier.mirrors.length > 0) {
            if (mirrors_with_valid_pool === tier_and_order.tier.mirrors.length) has_enough_healthy_nodes_for_tiering = true;
            if (mirrors_with_enough_nodes === tier_and_order.tier.mirrors.length) has_ehough_total_nodes_for_tiering = true;
        }
    });

    const objects_aggregate = {
        size: (bucket.storage_stats && bucket.storage_stats.objects_size) || 0,
        count: (bucket.storage_stats && bucket.storage_stats.objects_count) || 0
    };

    info.spillover_enabled = spillover_allowed_in_policy;

    const used_of_pools_in_policy = size_utils.json_to_bigint(size_utils.reduce_sum('blocks_size', tiering_pools_used_agg));
    const bucket_chunks_capacity = size_utils.json_to_bigint(_.get(bucket, 'storage_stats.chunks_capacity') || 0);
    const bucket_used = size_utils.json_to_bigint(_.get(bucket, 'storage_stats.blocks_size') || 0);
    const bucket_used_other = BigInteger.max(used_of_pools_in_policy.minus(bucket_used), BigInteger.zero);
    const bucket_free = size_utils.json_to_bigint(_.get(info, 'tiering.storage.free') || 0);
    const spillover_tier_storage = spillover_tier_in_policy && _.mapValues(_.get(tier_server.get_tier_info(
            spillover_tier_in_policy,
            nodes_aggregate_pool,
            aggregate_data_free_by_tier),
        'storage'), x => size_utils.json_to_bigint(x));

    const spillover_storage = _.mapValues(spillover_allowed_in_policy ?
        spillover_tier_storage : {
            free: 0,
            unavailable_free: 0
        }, x => size_utils.json_to_bigint(x));

    let is_storage_low = false;
    let is_no_storage = false;
    let is_no_storage_on_spillover = false;
    const bucket_total = bucket_free.plus(bucket_used)
        .plus(bucket_used_other)
        .plus(spillover_storage.free)
        .plus(spillover_storage.unavailable_free);

    info.storage = {
        values: size_utils.to_bigint_storage({
            used: bucket_used,
            used_other: bucket_used_other,
            total: bucket_total,
            free: bucket_free,
            spillover_free: spillover_storage.free.plus(spillover_storage.unavailable_free),
        }),
        last_update: _.get(bucket, 'storage_stats.last_update')
    };

    const actual_free = size_utils.json_to_bigint(_.get(info, 'tiering.data.free') || 0);
    let available_for_upload = actual_free.plus(spillover_storage.free);

    if (bucket_free.isZero()) {
        is_no_storage = true;
    } else {
        let free_percent = bucket_free.multiply(100).divide(bucket_total);
        if (free_percent < 30) {
            is_storage_low = true;
        }
    }
    if (available_for_upload.isZero()) {
        is_no_storage_on_spillover = true;
    }

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
        available_for_upload = size_utils.size_min([
            size_utils.bigint_to_json(quota_free),
            size_utils.bigint_to_json(available_for_upload)
        ]);
    }
    info.data = size_utils.to_bigint_storage({
        size: objects_aggregate.size,
        size_reduced: bucket_chunks_capacity,
        free: actual_free,
        available_for_upload,
        spillover_free: spillover_storage.free,
        last_update: _.get(bucket, 'storage_stats.last_update')
    });

    info.usage_by_pool = {
        pools: {},
        last_update: _.get(bucket, 'storage_stats.last_update')
    };

    info.usage_by_pool.pools = [];
    _.mapKeys(_.get(bucket, 'storage_stats.pools') || {}, function(storage, pool_id) {
        const pool = system_store.data.get_by_id(pool_id);
        if (pool) {
            info.usage_by_pool.pools.push({
                pool_name: system_store.data.get_by_id(pool_id).name,
                storage: storage
            });
        }
    });

    const stats = bucket.stats;
    const last_read = (stats && stats.last_read) ?
        new Date(bucket.stats.last_read).getTime() :
        undefined;
    const last_write = (stats && stats.last_write) ?
        new Date(bucket.stats.last_write).getTime() :
        undefined;
    const reads = (stats && stats.reads) ? stats.reads : undefined;
    const writes = (stats && stats.writes) ? stats.writes : undefined;

    info.stats = {
        reads: reads,
        writes: writes,
        last_read: last_read,
        last_write: last_write
    };

    if (cloud_sync_policy) {
        info.cloud_sync = cloud_sync_policy.status ? cloud_sync_policy : undefined;
    } else {
        info.cloud_sync = undefined;
    }

    info.mode = bucket.namespace ?
        calc_namespace_mode() :
        calc_bucket_mode({
            has_any_pool_configured,
            has_ehough_total_nodes_for_tiering,
            has_enough_healthy_nodes_for_tiering,
            is_no_storage,
            is_storage_low,
            is_quota_low,
            is_quota_exceeded,
            spillover_allowed_in_policy,
            is_no_storage_on_spillover
        });

    return info;
}

function calc_namespace_mode() {
    return 'OPTIMAL';
}

function calc_bucket_mode(metrics) {
    if (!metrics.has_any_pool_configured) {
        return metrics.spillover_allowed_in_policy ? 'SPILLOVER_NO_RESOURCES' : 'NO_RESOURCES';
    }
    if (!metrics.has_ehough_total_nodes_for_tiering) {
        return metrics.spillover_allowed_in_policy ? 'SPILLOVER_NOT_ENOUGH_RESOURCES' : 'NOT_ENOUGH_RESOURCES';
    }
    if (!metrics.has_enough_healthy_nodes_for_tiering) {
        return metrics.spillover_allowed_in_policy ? 'SPILLOVER_NOT_ENOUGH_HEALTHY_RESOURCES' : 'NOT_ENOUGH_HEALTHY_RESOURCES';
    }
    if (metrics.is_no_storage) {
        if (metrics.spillover_allowed_in_policy) {
            return metrics.is_no_storage_on_spillover ? 'NO_CAPACITY' : 'SPILLOVER_NO_CAPACITY';
        } else {
            return 'NO_CAPACITY';
        }
    }
    if (metrics.is_storage_low) {
        return 'LOW_CAPACITY';
    }
    if (metrics.is_quota_low) {
        return 'APPROUCHING_QOUTA';
    }
    if (metrics.is_quota_exceeded) {
        return 'EXCEEDING_QOUTA';
    }
    return 'OPTIMAL';
}

function resolve_tiering_policy(req, policy_name) {
    var tiering_policy = req.system.tiering_policies_by_name[policy_name];
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
            if (_.map(system.buckets_by_name).filter(b => !b.namespace).length === 1) {
                return 'LAST_BUCKET';
            }
            return MDStore.instance().has_any_completed_objects_in_bucket(bucket._id)
                .then(has_objects => {
                    if (has_objects) {
                        return 'NOT_EMPTY';
                    }
                });
        });
}


// EXPORTS
exports.new_bucket_defaults = new_bucket_defaults;
exports.get_bucket_info = get_bucket_info;
exports.can_delete_bucket = can_delete_bucket;
//Bucket Management
exports.create_bucket = create_bucket;
exports.read_bucket = read_bucket;
exports.update_bucket = update_bucket;
exports.delete_bucket = delete_bucket;
exports.delete_bucket_lifecycle = delete_bucket_lifecycle;
exports.set_bucket_lifecycle_configuration_rules = set_bucket_lifecycle_configuration_rules;
exports.get_bucket_lifecycle_configuration_rules = get_bucket_lifecycle_configuration_rules;
exports.get_bucket_namespaces = get_bucket_namespaces;
exports.list_buckets = list_buckets;
exports.update_buckets = update_buckets;
//exports.generate_bucket_access = generate_bucket_access;
exports.update_bucket_s3_access = update_bucket_s3_access;
//Cloud Sync policies
exports.get_cloud_sync = cloud_sync_server.get_cloud_sync;
exports.get_all_cloud_sync = cloud_sync_server.get_all_cloud_sync;
exports.delete_cloud_sync = cloud_sync_server.delete_cloud_sync;
exports.set_cloud_sync = cloud_sync_server.set_cloud_sync;
exports.update_cloud_sync = cloud_sync_server.update_cloud_sync;
exports.toggle_cloud_sync = cloud_sync_server.toggle_cloud_sync;
//Temporary - TODO: move to new server
exports.get_cloud_buckets = get_cloud_buckets;
exports.export_bucket_bandwidth_usage = export_bucket_bandwidth_usage;

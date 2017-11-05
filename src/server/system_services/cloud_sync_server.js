/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const js_utils = require('../../util/js_utils');
const { RpcError } = require('../../rpc');
const Dispatcher = require('../notifications/dispatcher');
const server_rpc = require('../server_rpc');
const cloud_utils = require('../../util/cloud_utils');
const system_store = require('../system_services/system_store').get_instance();

/**
 *
 * GET_CLOUD_SYNC_POLICY
 *
 */
function get_cloud_sync(req, bucket) {
    dbg.log3('get_cloud_sync');
    bucket = bucket || find_bucket(req);
    if (!bucket.cloud_sync || !bucket.cloud_sync.target_bucket) {
        return {};
    }
    return P.resolve(server_rpc.client.cloud_sync.get_policy_status({
            sysid: bucket.system._id.toString(),
            bucketid: bucket._id.toString()
        }, {
            auth_token: req.auth_token
        }))
        .then(res => {
            bucket.cloud_sync.status = res.status;
            bucket.cloud_sync.health = res.health;

            return {
                name: bucket.name,
                endpoint: bucket.cloud_sync.endpoint,
                endpoint_type: bucket.cloud_sync.endpoint_type || 'AWS',
                access_key: bucket.cloud_sync.access_keys.access_key,
                health: res.health,
                status: bucket.cloud_sync.status,
                last_sync: bucket.cloud_sync.last_sync.getTime() || undefined,
                target_bucket: bucket.cloud_sync.target_bucket,
                policy: {
                    schedule_min: bucket.cloud_sync.schedule_min,
                    c2n_enabled: bucket.cloud_sync.c2n_enabled,
                    n2c_enabled: bucket.cloud_sync.n2c_enabled,
                    additions_only: bucket.cloud_sync.additions_only,
                    paused: bucket.cloud_sync.paused,
                }
            };
        });
}

/**
 *
 * GET_ALL_CLOUD_SYNC_POLICIES
 *
 */
function get_all_cloud_sync(req) {
    return P.all(_.map(req.system.buckets_by_name,
        bucket => get_cloud_sync(req, bucket)));
}

/**
 *
 * DELETE_CLOUD_SYNC
 *
 */
function delete_cloud_sync(req) {
    dbg.log2('delete_cloud_sync:', req.rpc_params.name, 'on', req.system._id);
    var bucket = find_bucket(req);
    dbg.log3('delete_cloud_sync: delete on bucket', bucket);

    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    $unset: {
                        cloud_sync: 1
                    }
                }]
            }
        })
        .then(function() {
            return server_rpc.client.cloud_sync.refresh_policy({
                bucket_id: bucket._id.toString(),
            }, {
                auth_token: req.auth_token
            });
        })
        .then(res => {
            Dispatcher.instance().activity({
                event: 'bucket.remove_cloud_sync',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: `Cloud sync was removed from ${bucket.name} by ${req.account && req.account.name}`,
            });
            return res;
        })
        .return();
}

/**
 *
 * SET_CLOUD_SYNC
 *
 */
function set_cloud_sync(req) {
    dbg.log0('set_cloud_sync:', req.rpc_params);
    var connection = cloud_utils.find_cloud_connection(req.account, req.rpc_params.connection);
    var bucket = find_bucket(req);
    //Verify parameters, bi-directional sync can't be set with additions_only
    if (req.rpc_params.policy.additions_only &&
        req.rpc_params.policy.n2c_enabled &&
        req.rpc_params.policy.c2n_enabled) {
        dbg.warn('set_cloud_sync bi-directional sync cant be set with additions_only');
        throw new Error('bi-directional sync cant be set with additions_only');
    }
    var cloud_sync = {
        endpoint: connection.endpoint,
        endpoint_type: connection.endpoint_type || 'AWS',
        target_bucket: req.rpc_params.target_bucket,
        access_keys: {
            access_key: connection.access_key,
            secret_key: connection.secret_key,
            account_id: req.account._id
        },
        schedule_min: js_utils.default_value(req.rpc_params.policy.schedule_min, 60),
        last_sync: new Date(0),
        paused: false,
        c2n_enabled: js_utils.default_value(req.rpc_params.policy.c2n_enabled, true),
        n2c_enabled: js_utils.default_value(req.rpc_params.policy.n2c_enabled, true),
        additions_only: js_utils.default_value(req.rpc_params.policy.additions_only, false)
    };

    const already_used_by = cloud_utils.get_used_cloud_targets(cloud_sync.endpoint_type,
            system_store.data.buckets, system_store.data.pools, system_store.data.namespace_resources)
        .find(candidate_target => (candidate_target.endpoint === cloud_sync.endpoint &&
            candidate_target.target_name === cloud_sync.target_bucket));
    if (already_used_by) {
        dbg.error(`This endpoint is already being used by a ${already_used_by.usage_type}: ${already_used_by.source_name}`);
        throw new Error('Target already in use');
    }

    return system_store.make_changes({

            update: {
                buckets: [{
                    _id: bucket._id,
                    cloud_sync: cloud_sync
                }]
            }
        })
        .then(() => _set_all_files_for_sync(req.system, bucket))
        .then(() => server_rpc.client.cloud_sync.refresh_policy({
            bucket_id: bucket._id.toString()
        }, {
            auth_token: req.auth_token
        }))
        .then(() => {
            let desc_string = [];
            let sync_direction;
            if (cloud_sync.c2n_enabled && cloud_sync.n2c_enabled) {
                sync_direction = 'Bi-Directional';
            } else if (cloud_sync.c2n_enabled) {
                sync_direction = 'Target To Source';
            } else if (cloud_sync.n2c_enabled) {
                sync_direction = 'Source To Target';
            } else {
                sync_direction = 'None';
            }
            desc_string.push(`Cloud sync was set in ${bucket.name}:`);
            desc_string.push(`Connection details:`);
            desc_string.push(`Name: ${connection.name}`);
            desc_string.push(`Target bucket: ${cloud_sync.target_bucket}`);
            desc_string.push(`Endpoint: ${cloud_sync.endpoint}`);
            desc_string.push(`Access key: ${cloud_sync.access_keys.access_key}`);
            desc_string.push(`Sync configurations:`);
            desc_string.push(`Frequency: Every ${cloud_sync.schedule_min} mins`);
            desc_string.push(`Direction: ${sync_direction}`);
            desc_string.push(`Sync Deletions: ${!cloud_sync.additions_only}`);

            Dispatcher.instance().activity({
                event: 'bucket.set_cloud_sync',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
        })
        .catch(function(err) {
            dbg.error('Error setting cloud sync', err, err.stack);
            throw err;
        })
        .return();
}


/**
 *
 * UPDATE_CLOUD_SYNC
 *
 */
function update_cloud_sync(req) {
    dbg.log0('update_cloud_sync:', req.rpc_params);
    var bucket = find_bucket(req);
    if (!bucket.cloud_sync || !bucket.cloud_sync.target_bucket) {
        throw new RpcError('INVALID_REQUEST', 'Bucket has no cloud sync policy configured');
    }
    var updated_policy = {
        cloud_sync: Object.assign({}, bucket.cloud_sync, req.rpc_params.policy)
    };

    var sync_directions_changed = Object.keys(req.rpc_params.policy)
        .filter(key => key !== 'schedule_min' && key !== 'additions_only')
        .some(key => updated_policy.cloud_sync[key] !== bucket.cloud_sync[key]);

    var should_resync = false;
    var should_resync_deleted_files = false;

    // Please see the explanation and decision table below (at the end of the file).
    if (updated_policy.cloud_sync.additions_only === bucket.cloud_sync.additions_only) {
        should_resync = sync_directions_changed && (
            bucket.cloud_sync.c2n_enabled &&
            !bucket.cloud_sync.n2c_enabled
        );
        should_resync_deleted_files = should_resync;
    } else if (updated_policy.cloud_sync.additions_only) {
        should_resync = sync_directions_changed && (
            bucket.cloud_sync.c2n_enabled &&
            !bucket.cloud_sync.n2c_enabled
        );
    } else {
        should_resync = !(updated_policy.cloud_sync.c2n_enabled && !updated_policy.cloud_sync.n2c_enabled);
        should_resync_deleted_files = should_resync;
    }

    const db_updates = {
        _id: bucket._id
    };

    Object.keys(req.rpc_params.policy).forEach(key => {
        db_updates['cloud_sync.' + key] = req.rpc_params.policy[key];
    });
    return system_store.make_changes({
            update: {
                buckets: [db_updates]
            }
        })
        .then(() => should_resync && _set_all_files_for_sync(req.system, bucket, should_resync_deleted_files))
        .then(() => server_rpc.client.cloud_sync.refresh_policy({
            bucket_id: bucket._id.toString(),
        }, {
            auth_token: req.auth_token
        }))
        .then(res => {
            let desc_string = [];
            let sync_direction;
            if (updated_policy.cloud_sync.c2n_enabled && updated_policy.cloud_sync.n2c_enabled) {
                sync_direction = 'Bi-Directional';
            } else if (updated_policy.cloud_sync.c2n_enabled) {
                sync_direction = 'Target To Source';
            } else if (updated_policy.cloud_sync.n2c_enabled) {
                sync_direction = 'Source To Target';
            } else {
                sync_direction = 'None';
            }
            desc_string.push(`Cloud sync was updated in ${bucket.name}:`);
            desc_string.push(`Sync configurations:`);
            desc_string.push(`Frequency: Every ${updated_policy.cloud_sync.schedule_min} mins`);
            desc_string.push(`Direction: ${sync_direction}`);
            desc_string.push(`Sync Deletions: ${!updated_policy.cloud_sync.additions_only}`);

            Dispatcher.instance().activity({
                event: 'bucket.update_cloud_sync',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                bucket: bucket._id,
                desc: desc_string.join('\n'),
            });
            return res;
        })
        .catch(function(err) {
            dbg.error('Error updating cloud sync', err, err.stack);
            throw err;
        })
        .return();
}


function toggle_cloud_sync(req) {
    let bucket = find_bucket(req);
    let cloud_sync = bucket.cloud_sync;
    if (!cloud_sync) {
        dbg.error('cloud_sync policy is not set');
        throw new Error('cloud_sync policy is not set');
    }

    if (cloud_sync.paused === req.rpc_params.pause) {
        dbg.log0('cloud_sync is already', cloud_sync.paused ? 'paused' : 'running', 'skipping');
        return;
    }

    cloud_sync.paused = req.rpc_params.pause;
    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    'cloud_sync.paused': cloud_sync.paused
                }]
            }
        })
        .then(function() {
            return server_rpc.client.cloud_sync.refresh_policy({
                bucket_id: bucket._id.toString()
            }, {
                auth_token: req.auth_token
            });
        });
}

/**
 * _set_all_files_for_sync - mark all objects on specific bucket for sync
 */
function _set_all_files_for_sync(system, bucket, should_resync_deleted_files) {
    dbg.log0('_set_all_files_for_sync: START',
        'system', system.name,
        'bucket', bucket.name,
        'should_resync_deleted_files', should_resync_deleted_files);

    // TODO:: scale, fine for 1000 objects, not for 1M
    return P.join(
            // Mark all "live" objects to be cloud synced
            MDStore.instance().update_all_objects_of_bucket_unset_cloud_sync(bucket._id),
            // Mark all "previous" deleted objects as not needed for cloud sync
            should_resync_deleted_files &&
            MDStore.instance().update_all_objects_of_bucket_set_deleted_cloud_sync(bucket._id)
        )
        .then(() => dbg.log0('_set_all_files_for_sync: DONE',
            'system', system.name,
            'bucket', bucket.name,
            'should_resync_deleted_files', should_resync_deleted_files));
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

/*
                ***UPDATE CLOUD SYNC DECISION TABLES***
Below are the files syncing decision tables for all cases of policy change:

RS - Stands for marking the files for Re-Sync (NOT deleted files only!).
DF - Stands for marking the DELETED files for Re-Sync.
NS - Stands for NOT marking files for Re-Sync (Both deleted and not).

Sync Deletions property did not change:
+------------------------------+----------------+------------------+------------------+
| Previous Sync / Updated Sync | Bi-Directional | Source To Target | Target To Source |
+------------------------------+----------------+------------------+------------------+
| Bi-Directional               | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Source To Target             | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Target To Source             | RS + DF        | RS + DF          | NS               |
+------------------------------+----------------+------------------+------------------+

Sync Deletions property changed to TRUE:
+------------------------------+----------------+------------------+------------------+
| Previous Sync / Updated Sync | Bi-Directional | Source To Target | Target To Source |
+------------------------------+----------------+------------------+------------------+
| Bi-Directional               | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Source To Target             | RS + DF        | RS + DF          | NS               |
+------------------------------+----------------+------------------+------------------+
| Target To Source             | RS + DF        | RS + DF          | NS               |
+------------------------------+----------------+------------------+------------------+

Sync Deletions property changed to FALSE:
+------------------------------+----------------+------------------+------------------+
| Previous Sync / Updated Sync | Bi-Directional | Source To Target | Target To Source |
+------------------------------+----------------+------------------+------------------+
| Bi-Directional               | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Source To Target             | NS             | NS               | NS               |
+------------------------------+----------------+------------------+------------------+
| Target To Source             | RS             | RS               | NS               |
+------------------------------+----------------+------------------+------------------+
*/


// EXPORTS
//Cloud Sync policies
exports.get_cloud_sync = get_cloud_sync;
exports.get_all_cloud_sync = get_all_cloud_sync;
exports.delete_cloud_sync = delete_cloud_sync;
exports.set_cloud_sync = set_cloud_sync;
exports.update_cloud_sync = update_cloud_sync;
exports.toggle_cloud_sync = toggle_cloud_sync;

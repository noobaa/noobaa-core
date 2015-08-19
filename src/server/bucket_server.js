/* jshint node:true */
'use strict';

/**
 *
 * BUCKET_SERVER
 *
 */

module.exports = {
    //Bucket Management
    create_bucket: create_bucket,
    read_bucket: read_bucket,
    update_bucket: update_bucket,
    delete_bucket: delete_bucket,
    list_buckets: list_buckets,

    //Cloud Sync policies
    get_cloud_sync_policy: get_cloud_sync_policy,
    get_all_cloud_sync_policies: get_all_cloud_sync_policies,
    delete_cloud_sync: delete_cloud_sync,
    set_cloud_sync: set_cloud_sync
};

var _ = require('lodash');
var Q = require('q');
var AWS = require('aws-sdk');
var db = require('./db');
var object_server = require('./object_server');
var promise_utils = require('../util/promise_utils');
var js_utils = require('../util/js_utils');
var dbg = require('noobaa-util/debug_module')(__filename);

var CLOUD_SYNC = {
    //Policy was changed, list of policies should be refreshed
    refresh_list: false,

    //Configured policies cache
    configured_policies: [],

    //works lists (addition/deletion) per each configured bucket
    work_lists: [],

    //AWS.S3 object
    s3bucket: null,
};

/**
 *
 * CREATE_BUCKET
 *
 */
function create_bucket(req) {
    return resolve_tiering(req.system.id, req.rpc_params.tiering)
        .then(function(tiering) {
            var info = _.pick(req.rpc_params, 'name');
            info.system = req.system.id;
            if (tiering) {
                info.tiering = tiering;
            }
            return db.Bucket.create(info);
        })
        .then(function(bucket) {
            console.log('create bucket:', bucket);
            return db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'bucket.create',
                bucket: bucket,
            });
        })
        .then(null, db.check_already_exists(req, 'bucket'))
        .thenResolve();
}

/**
 *
 * READ_BUCKET
 *
 */
function read_bucket(req) {
    return Q.when(db.Bucket
            .findOne(get_bucket_query(req))
            .populate('tiering.tier')
            .exec())
        .then(db.check_not_deleted(req, 'bucket'))
        .then(function(bucket) {
            var reply = get_bucket_info(bucket);
            // TODO read bucket's storage and objects info
            reply.storage = {
                alloc: 0,
                used: 0,
            };
            reply.num_objects = 0;
            return reply;
        });
}



/**
 *
 * UPDATE_BUCKET
 *
 */
function update_bucket(req) {
    return resolve_tiering(req.system.id, req.rpc_params.tiering)
        .then(function(tiering) {
            var updates = {};
            if (req.rpc_params.new_name) {
                updates.name = req.rpc_params.new_name;
            }
            if (tiering) {
                updates.tiering = tiering;
            }
            return db.Bucket
                .findOneAndUpdate(get_bucket_query(req), updates)
                .exec();
        })
        .then(db.check_not_deleted(req, 'bucket'))
        .thenResolve();
}



/**
 *
 * DELETE_BUCKET
 *
 */
function delete_bucket(req) {
    var updates = {
        deleted: new Date()
    };
    return Q.when(db.Bucket
            .findOneAndUpdate(get_bucket_query(req), updates)
            .exec())
        .then(function(bucket_info) {
            return db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'bucket.delete',
                bucket: bucket_info,
            });
        })
        .then(db.check_not_found(req, 'bucket'))
        .thenResolve();
}



/**
 *
 * LIST_BUCKETS
 *
 */
function list_buckets(req) {
    return Q.when(db.Bucket
            .find({
                system: req.system.id,
                deleted: null,
            })
            .populate('tiering.tier')
            .exec())
        .then(function(buckets) {
            return {
                buckets: _.map(buckets, function(bucket) {
                    return _.pick(bucket, 'name');
                })
            };
        });
}

/**
 *
 * GET_CLOUD_SYNC_POLICY
 *
 */
function get_cloud_sync_policy(req) {
    dbg.log3('get_cloud_sync_policy');
    var reply = [];
    return Q.when(db.Bucket
            .find({
                system: req.system.id,
                name: req.rpc_params.name,
                deleted: null,
            })
            .exec())
        .then(function(bucket) {
            if (bucket.cloud_sync.endpoint) {
                reply.push({
                    name: bucket.name,
                    policy: {
                        endpoint: bucket.cloud_sync.endpoint,
                        access_keys: bucket.cloud_sync.access_keys,
                        schedule: bucket.cloud_sync.schedule,
                        last_sync: bucket.cloud_sync.last_sync,
                        paused: bucket.cloud_sync.paused
                    },
                    health: get_policy_health(bucket._id, req.system.id),
                    status: get_policy_status(bucket._id, req.system.id),
                });
            }
            return {
                cloud_sync_policy: reply
            };
        });
}

/**
 *
 * GET_ALL_CLOUD_SYNC_POLICIES
 *
 */
function get_all_cloud_sync_policies(req) {
    dbg.log3('get_all_cloud_sync_policies');
    var reply = [];
    return Q.when(db.Bucket
            .find({
                system: req.system.id,
                deleted: null,
            })
            .exec())
        .then(function(buckets) {
            _.each(buckets, function(bucket, i) {
                if (bucket.cloud_sync.endpoint) {
                    reply.push({
                        name: bucket.name,
                        policy: {
                            endpoint: bucket.cloud_sync.endpoint,
                            access_keys: bucket.cloud_sync.access_keys,
                            schedule: bucket.cloud_sync.schedule,
                            last_sync: bucket.cloud_sync.last_sync,
                            paused: bucket.cloud_sync.paused
                        },
                        health: get_policy_health(bucket._id, req.system.id),
                        status: get_policy_status(bucket._id, req.system.id),
                    });
                }
            });
            return {
                cloud_sync_policies: reply
            };
        });
}

/**
 *
 * DELETE_CLOUD_SYNC
 *
 */
function delete_cloud_sync(req) {
    dbg.log2('delete_cloud_sync:', req.rpc_params.name, 'on', req.system.id);
    var updates = {
        cloud_sync: {}
    };
    return Q.when(db.Bucket
            .find({
                system: req.system.id,
                name: req.rpc_params.name,
                deleted: null,
            })
            .exec())
        .then(function(bucket) {
            dbg.log3('delete_cloud_sync: delete on bucket', bucket);
            return Q.when(db.Bucket
                .findOneAndUpdate(get_bucket_query(req), updates)
                .exec());
        })
        .then(function() {
            CLOUD_SYNC.refresh_list = true;
        })
        .thenResolve();
}

/**
 *
 * SET_CLOUD_SYNC
 *
 */
function set_cloud_sync(req) {
    dbg.log0('set_cloud_sync:', req.rpc_params.name, 'on', req.system.id, 'with', req.rpc_params.policy);
    var updates = {
        cloud_sync: {
            endpoint: req.rpc_params.policy.endpoint,
            access_keys: {
                access_key: req.rpc_params.policy.access_keys[0].access_key,
                secret_key: req.rpc_params.policy.access_keys[0].secret_key
            },
            schedule: req.rpc_params.policy.schedule,
            paused: req.rpc_params.policy.paused,
        }
    };
    return Q.when(db.Bucket
            .find({
                system: req.system.id,
                name: req.rpc_params.name,
                deleted: null,
            })
            .exec())
        .then(function(bucket) {
            return Q.when(db.Bucket
                .findOneAndUpdate(get_bucket_query(req), updates)
                .exec());
        })
        .then(function() {
            CLOUD_SYNC.refresh_list = true;
        })
        .thenResolve();
}

// UTILS //////////////////////////////////////////////////////////


function get_bucket_query(req) {
    return {
        system: req.system.id,
        name: req.rpc_params.name,
        deleted: null,
    };
}

function get_bucket_info(bucket) {
    var reply = _.pick(bucket, 'name');
    if (bucket.tiering) {
        reply.tiering = _.map(bucket.tiering, function(t) {
            return t.tier.name;
        });
    }
    return reply;
}

function resolve_tiering(system_id, tiering) {
    if (!tiering) return Q.resolve();
    return Q.when(db.Tier
            .find({
                system: system_id,
                name: {
                    $in: tiering
                },
                deleted: null,
            })
            .exec())
        .then(function(tiers) {
            var tiers_by_name = _.indexBy(tiers, 'name');
            return _.map(tiering, function(name) {
                var tier = tiers_by_name[name];
                if (!tier) {
                    console.log('TIER NOT FOUND', name);
                    throw new Error('missing tier');
                }
                return {
                    tier: tier
                };
            });
        });
}

function get_policy_health(bucketid, sysid) {
    var policy = _.find(CLOUD_SYNC.configured_policies, function(p) {
        return p.system._id === sysid && p.bucket.id === bucketid;
    });

    return policy.health;
}

function get_policy_status(bucketid, sysid) {
    var work_list = _.find(CLOUD_SYNC.work_lists, function(wl) {
        return wl.sysid === sysid && wl.bucketid === bucketid;
    });

    //TODO:: Add check against c2n lists lengths as well
    if (work_list.added.length || work_list.deleted.length) {
        return 'SYNCING';
    } else {
        return 'IDLE';
    }
}

/*
 *************  BACKGROUND WORKERS & Internal Workers Functions  *************
 */

//Load all configured could sync policies into global CLOUD_SYNC
function load_configured_policies() {
    dbg.log2('load_configured_policies');
    CLOUD_SYNC.configured_policies = [];
    return Q.when(db.Bucket
            .find({
                deleted: null,
            })
            .populate('system')
            .exec())
        .then(function(buckets) {
            _.each(buckets, function(bucket, i) {
                if (bucket.cloud_sync.endpoint) {
                    dbg.log4('adding sysid', bucket.system._id, 'bucket', bucket.name, bucket._id, 'bucket', bucket, 'to configured policies');
                    CLOUD_SYNC.configured_policies.push({
                        bucket: {
                            name: bucket.name,
                            id: bucket._id
                        },
                        system: bucket.system,
                        endpoint: bucket.cloud_sync.endpoint,
                        access_keys: {
                            access_key: bucket.cloud_sync.access_keys.access_key,
                            secret_key: bucket.cloud_sync.access_keys.secret_key
                        },
                        schedule: bucket.cloud_sync.schedule,
                        paused: bucket.cloud_sync.paused,
                        last_refresh: (bucket.cloud_sync.last_sync) ? bucket.cloud_sync.last_sync : 0,
                        health: true,
                    });
                }
            });
            CLOUD_SYNC.refresh_list = false;
        });
}

function update_work_list(policy) {
    return Q.allSettled([
        update_n2c_worklist(policy),
        update_c2n_worklist(policy)
    ]);
}

//TODO:: SCALE: Limit to batches like the build worker does
function update_n2c_worklist(policy) {
    dbg.log2('update_n2c_worklist sys', policy.system._id, 'bucket', policy.bucket.id);
    return Q.fcall(function() {
            return object_server.list_need_sync(policy.system._id, policy.bucket.id);
        })
        .then(function(res) {
            var ind = _.findIndex(CLOUD_SYNC.work_lists, function(b) {
                return b.sysid === policy.system._id &&
                    b.bucketid === policy.bucket.id;
            });
            if (ind === -1) {
                CLOUD_SYNC.work_lists.push({
                    sysid: policy.system._id,
                    bucketid: policy.bucket.id,
                    added: res.added,
                    deleted: res.deleted,
                });
            } else {
                CLOUD_SYNC.work_lists[ind].added = res.added;
                CLOUD_SYNC.work_lists[ind].deleted = res.deleted;
            }
            dbg.log2('DONE update_n2c_worklist sys', policy.system._id, 'bucket', policy.bucket.id, 'total changes', res.added.length + res.deleted.length);
            return;
        });
}

//Update work lists for specific policy
//TODO:: SCALE: Limit to batches like the build worker does
function update_c2n_worklist(policy) {
    dbg.log2('update_c2n_worklist sys', policy.system._id, 'bucket', policy.bucket.id);
    //TODO:: this is problematic, global config ? should be per AWS.S3 creation...
    //multi can cause failures
    AWS.config.update({
        accessKeyId: policy.access_keys.access_key,
        secretAccessKey: policy.access_keys.secret_key,
        region: 'eu-west-1', //TODO:: WA for AWS poorly developed SDK
    });

    var target = policy.endpoint;
    var s3 = new AWS.S3();
    var params = {
        Bucket: target,
    };

    //Take a list from the cloud, list from the bucket, keep only key and ETag
    //Compare the two for diffs of additions/deletions
    var cloud_object_list, bucket_object_list;
    return Q.ninvoke(s3, 'listObjects', params)
        .fail(function(error) {
            dbg.error('update_c2n_worklist failed to list files from cloud: sys', policy.system._id, 'bucket',
                policy.bucket.id, error, error.stack);
            throw new Error('update_c2n_worklist failed to list files from cloud');
        })
        .then(function(cloud_obj) {
            cloud_object_list = _.map(cloud_obj.Contents, function(obj) {
                return {
                    //TODO:: NBNB add this back once ul is real etag: obj.ETag,
                    key: obj.Key
                };
            });
            dbg.log2('update_c2n_worklist cloud_object_list length', cloud_object_list.length);
            return object_server.list_all_objects(policy.system._id, policy.bucket.id);
        })
        .then(function(bucket_obj) {
            bucket_object_list = _.map(bucket_obj, function(obj) {
                return {
                    //TODO:: NBNB add this back once ul is real etag: obj.etag,
                    key: obj.key
                };
            });
            dbg.log2('update_c2n_worklist bucket_object_list length', bucket_object_list.length);
            var diff = js_utils.diff_arrays(cloud_object_list, bucket_object_list, function(a, b) {
                if (a.key < b.key) {
                    return -1;
                } else if (a.key > b.key) {
                    return 1;
                } else {
                    //TODO::NBNB take into account the etag once its back, for overwrite scenarios, if same etag, drop
                    return 0;
                }
            });
            dbg.log2('update_c2n_worklist found ', diff.uniq_a.length + diff.uniq_b.length, 'diffs to resolve');
        });
}

//sync a single file to the cloud
function sync_single_file_to_cloud(object, target, s3) {
    dbg.log3('sync_single_file_to_cloud', object.key, '->', target + '/' + object.key);

    //TODO:: remove this require, read actual file
    var fs = require('fs');
    var body = fs.createReadStream('../config.js');
    //Read file
    var params = {
        Bucket: target,
        Key: object.key,
        ContentType: object.content_type,
        Body: body
    };

    return Q.ninvoke(s3, 'upload', params)
        .then(function() {
            return object_server.mark_cloud_synced(object);
        })
        .fail(function(err) {
            dbg.error('Error sync_single_file_to_cloud', object.key, '->', target + '/' + object.key,
                err, err.stack);
            throw new Error('Error sync_single_file_to_cloud ' + object.key + ' -> ' + target);
        });
}

//Perform n2c cloud sync for a specific policy with a given work list
function sync_to_cloud_single_bucket(bucket_work_list, policy) {
    dbg.log1('Start sync_to_cloud_single_bucket on work list', bucket_work_list, 'policy', policy);
    if (!bucket_work_list || !policy) {
        throw new Error('bucket_work_list and bucket_work_list must be provided');
    }

    //TODO:: this is problematic, global config ? should be per AWS.S3 creation...
    //multi can cause failures
    AWS.config.update({
        accessKeyId: policy.access_keys.access_key,
        secretAccessKey: policy.access_keys.secret_key,
        region: 'eu-west-1', //TODO:: WA for AWS poorly developed SDK
    });

    var target = policy.endpoint;
    var s3 = new AWS.S3();
    //First delete all the deleted objects
    return Q.fcall(function() {
            if (bucket_work_list.deleted.length) {
                var params = {
                    Bucket: target,
                    Delete: {
                        Objects: [],
                    },
                };

                _.each(bucket_work_list.deleted, function(obj) {
                    params.Delete.Objects.push({
                        Key: obj.key
                    });
                });
                dbg.log1('sync_to_cloud_single_bucket syncing', bucket_work_list.deleted.length, 'deletions n2c');
                return Q.ninvoke(s3, 'deleteObjects', params);
            } else {
                dbg.log1('sync_to_cloud_single_bucket syncing deletions n2c, nothing to sync');
                return;
            }
        })
        .then(function() {
            //marked deleted objects as cloud synced
            return Q.all(_.map(bucket_work_list.deleted, function(object) {
                return object_server.mark_cloud_synced(object);
            }));
        })
        .fail(function(error) {
            dbg.error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c', error, error.stack);
        })
        .then(function() {
            //empty deleted work list jsperf http://jsperf.com/empty-javascript-array
            while (bucket_work_list.deleted.length > 0) {
                bucket_work_list.deleted.pop();
            }
            //Now upload the new objects
            if (bucket_work_list.added.length) {
                return Q.all(_.map(bucket_work_list.added, function(object) {
                    return sync_single_file_to_cloud(object, target, s3);
                }));
            } else {
                dbg.log1('sync_to_cloud_single_bucket syncing additions n2c, nothing to sync');
            }
        })
        .fail(function(error) {
            dbg.error('sync_to_cloud_single_bucket Failed syncing added objects n2c', error, error.stack);
        })
        .then(function() {
            dbg.log1('Done sync_to_cloud_single_bucket on {', policy.bucket.name, policy.system._id, policy.endpoint, '}');
            return;
        });
}

//Perform c2n cloud sync for a specific policy with a given work list
function sync_from_cloud_single_bucket(bucket_work_list, policy) {

}

//Cloud Sync Refresher worker
promise_utils.run_background_worker({
    name: 'cloud_sync_refresher',

    run_batch: function() {
        //var self = this;
        var now = Date.now();

        return Q.fcall(function() {
                dbg.log2('CLOUD_SYNC_REFRESHER:', 'BEGIN');
                ///if policies not loaded, load them now
                if (CLOUD_SYNC.configured_policies.length === 0 || CLOUD_SYNC.refresh_list) {
                    load_configured_policies();
                }
            })
            .then(function() {
                return Q.all(_.map(CLOUD_SYNC.configured_policies, function(policy) {
                    if (((now - policy.last_refresh) / 1000 / 60 / 60) > policy.schedule &&
                        !policy.paused) {
                        return update_work_list(policy);
                    }
                }));
            })
            .then(function() {
                return Q.all(_.map(CLOUD_SYNC.work_lists, function(single_bucket) {
                    var current_policy = _.find(CLOUD_SYNC.configured_policies, function(p) {
                        return p.system._id === single_bucket.sysid &&
                            p.bucket.id === single_bucket.bucketid;
                    });
                    //Sync n2c
                    return Q.when(sync_to_cloud_single_bucket(single_bucket, current_policy))
                        .then(function() {
                            //Sync c2n
                            return sync_from_cloud_single_bucket(single_bucket, current_policy);
                        })
                        .fail(function(error) {
                            dbg.error('cloud_sync_refresher failed syncing objects for bucket', single_bucket, 'with', error, error.stack);
                        });
                }));
            })
            .fail(function(error) {
                dbg.error('cloud_sync_refresher Failed', error, error.stack);
            })
            .then(function() {
                return Q.fcall(function() {
                    dbg.log2('CLOUD_SYNC_REFRESHER:', 'END');
                    return 6000; //TODO:: NBNB move back to 600000
                });
            });
    }
});

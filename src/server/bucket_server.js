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
    set_cloud_sync: set_cloud_sync,

    //Temporary - TODO: move to new server
    get_cloud_buckets: get_cloud_buckets
};

var _ = require('lodash');
var Q = require('q');
var AWS = require('aws-sdk');
var db = require('./db');
var object_server = require('./object_server');
var promise_utils = require('../util/promise_utils');
var dbg = require('noobaa-util/debug_module')(__filename);

var CLOUD_SYNC = {
    //Policy was changed, list of policies should be refreshed
    refresh_list: false,

    //Configured policies cache & related objects
    configured_policies: [],

    //works lists (n2c/c2n -> addition/deletion) per each configured cloud synced bucket
    work_lists: [],
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
        .then(function() {
            CLOUD_SYNC.refresh_list = true;
        })
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
//TODO:: wait till refresh_list is false
function get_cloud_sync_policy(req) {
    dbg.log3('get_cloud_sync_policy');
    var reply = [];
    return Q.when(db.Bucket
            .findOne({
                system: req.system.id,
                name: req.rpc_params.name,
                deleted: null,
            })
            .exec())
        .then(function(bucket) {
            if (bucket.cloud_sync && bucket.cloud_sync.endpoint) {
                reply = {
                    name: bucket.name,
                    policy: {
                        endpoint: bucket.cloud_sync.endpoint,
                        access_keys: [bucket.cloud_sync.access_keys],
                        schedule: bucket.cloud_sync.schedule_min,
                        last_sync: bucket.cloud_sync.last_sync.getTime(),
                        paused: bucket.cloud_sync.paused
                    },
                    health: get_policy_health(bucket._id, req.system.id),
                    status: get_policy_status(bucket._id, req.system.id),
                };

                return reply;
            } else {
                return {};
            }
        });
}

/**
 *
 * GET_ALL_CLOUD_SYNC_POLICIES
 *
 */
//TODO:: wait till refresh_list is false
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
                            access_keys: [bucket.cloud_sync.access_keys],
                            schedule: bucket.cloud_sync.schedule_min,
                            last_sync: bucket.cloud_sync.last_sync,
                            paused: bucket.cloud_sync.paused
                        },
                        health: get_policy_health(bucket._id, req.system.id),
                        status: get_policy_status(bucket._id, req.system.id),
                    });
                }
            });
            return reply;
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
    var bucket;
    var updates = {
        cloud_sync: {
            endpoint: req.rpc_params.policy.endpoint,
            access_keys: {
                access_key: req.rpc_params.policy.access_keys[0].access_key,
                secret_key: req.rpc_params.policy.access_keys[0].secret_key
            },
            schedule_min: req.rpc_params.policy.schedule,
            last_sync: 0,
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
        .then(function(b) {
            bucket = b[0];
            return Q.when(db.Bucket
                .findOneAndUpdate(get_bucket_query(req), updates)
                .exec());
        })
        .then(function() {
            //TODO:: scale, fine for 1000 objects, not for 1M
            return object_server.set_all_files_for_sync(req.system.id, bucket._id);
        })
        .then(function() {
            CLOUD_SYNC.refresh_list = true;
            return;
        }).then(null, function(err) {
            throw new Error(err.message);
        })
        .thenResolve();
}


/**
 *
 * GET_CLOUD_BUCKETS
 *
 */
function get_cloud_buckets(req) {
    var buckets = [];
    return Q.fcall(function() {
        var s3 = new AWS.S3({
            accessKeyId: req.rpc_params.access_key,
            secretAccessKey: req.rpc_params.secret_key,
            sslEnabled: false
        });
        return Q.ninvoke(s3, "listBuckets");
    }).then(function(data) {
        _.each(data.Buckets, function(bucket) {
            buckets.push(bucket.Name);
        });
        return buckets;
    }).then(null, function(err) {
        console.log("Error:", err.message);
        throw new Error(err.message);
    });

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
    dbg.log3('get policy health', bucketid, sysid, CLOUD_SYNC.configured_policies);
    var policy = _.find(CLOUD_SYNC.configured_policies, function(p) {
        return (p.system._id.toString() === sysid &&
            p.bucket.id.toString() === bucketid.toString());
    });
    if (policy) {
        return policy.health;
    } else {
        return true;
    }
}

function get_policy_status(bucketid, sysid) {
    var work_list = _.find(CLOUD_SYNC.work_lists, function(wl) {
        return wl.sysid.toString() === sysid &&
            wl.bucketid.toString() === bucketid.toString();
    });

    if (!is_empty_sync_worklist(work_list)) {
        return 'SYNCING';
    } else {
        return 'IDLE';
    }
}

function is_empty_sync_worklist(work_list) {
    if (work_list.n2c_added.length || work_list.n2c_deleted.length ||
        work_list.c2n_added.length || work_list.c2n_deleted.length) {
        return false;
    } else {
        return true;
    }
}

//return pretty (printable) policy obj
function pretty_policy(policy) {
    return {
        bucket_name: policy.bucket.name,
        bucket_id: policy.bucket.id,
        system_id: policy.system._id,
        endpoint: policy.endpoint,
        schedule_min: policy.schedule_min,
        last_sync: policy.last_sync,
    };
}

/*
 *************  BACKGROUND WORKERS & Internal Workers Functions  *************
 */

function diff_worklists(wl1, wl2, sync_time) {
    var uniq_1 = [],
        uniq_2 = [];
    var pos1 = 0,
        pos2 = 0;

    var comp = function(a, b, sync_time) {
        if (a.key < b.key) {
            return -1;
        } else if (a.key > b.key) {
            return 1;
        } else {
            if (a.create_time > sync_time) {
                return 2;
            } else if (b.create_time > sync_time) {
                return -2;
            } else {
                return 0;
            }
        }
    };

    if (wl1.length === 0 || wl2.length === 0) {
        return {
            uniq_a: wl1,
            uniq_b: wl2
        };
    }

    if (wl1.length === 0 || wl2.length === 0) {
        return {
            uniq_a: wl1,
            uniq_b: wl2
        };
    }

    while (comp(wl1[pos1], wl2[pos2]) === -1) {
        uniq_1.push(wl1[pos1]);
        pos1++;
    }

    var res;
    while (pos1 < wl1.length && pos2 < wl2.length) {
        res = comp(wl1[pos1], wl2[pos2]);
        if (res === -1) { //appear in bucket
            uniq_1.push(wl1[pos1]);
            pos1++;
        } else if (res === 1) { //appear in cloud
            uniq_2.push(wl2[pos2]);
            pos2++;
        } else if (res === 2) { //same key, mod time newer in bucket
            uniq_1.push(wl1[pos1]);
            pos1++;
            pos2++;
        } else if (res === -2) { //same key, mod time newer in cloud
            uniq_2.push(wl2[pos2]);
            pos1++;
            pos2++;
        } else { //same key, same mod time
            pos1++;
            pos2++;
        }
    }

    //Handle tails
    for (; pos1 < wl1.length; ++pos1) {
        uniq_1.push(wl1[pos1]);
        pos1++;
    }

    for (; pos2 < wl2.length; ++pos2) {
        uniq_2.push(wl2[pos2]);
        pos2++;
    }

    dbg.log4('diff_arrays recieved wl1 #', wl1.length, 'wl2 #', wl2.length, 'returns uniq_1', uniq_1, 'uniq_2', uniq_2);

    return {
        uniq_a: uniq_1,
        uniq_b: uniq_2
    };
}

//Load all configured could sync policies into global CLOUD_SYNC
function load_configured_policies() {
    dbg.log2('load_configured_policies');
    CLOUD_SYNC.configured_policies = [];
    CLOUD_SYNC.work_lists = [];
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
                    //Cache Configuration, S3 Objects and empty work lists
                    var policy = {
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
                        schedule_min: bucket.cloud_sync.schedule_min,
                        paused: bucket.cloud_sync.paused,
                        c2n_enabled: true, //TODO:: Should be passed in policy coinfiguration
                        n2c_enabled: true, //TODO:: Should be passed in policy coinfiguration
                        last_sync: (bucket.cloud_sync.last_sync) ? bucket.cloud_sync.last_sync : 0,
                        health: true,
                        s3rver: null,
                        s3cloud: null,
                    };
                    //Create a corresponding local bucket s3 object and a cloud bucket object
                    policy.s3rver = new AWS.S3({
                        endpoint: 'http://127.0.0.1',
                        s3ForcePathStyle: true,
                        sslEnabled: false,
                        accessKeyId: policy.system.access_keys[0].access_key,
                        secretAccessKey: policy.system.access_keys[0].secret_key,
                    });

                    policy.s3cloud = new AWS.S3({
                        accessKeyId: policy.access_keys.access_key,
                        secretAccessKey: policy.access_keys.secret_key,
                        region: 'eu-west-1', //TODO:: WA for AWS poorly developed SDK :-/
                    });

                    CLOUD_SYNC.configured_policies.push(policy);

                    //Init empty work lists for current policy
                    CLOUD_SYNC.work_lists.push({
                        sysid: bucket.system._id,
                        bucketid: bucket._id,
                        n2c_added: [],
                        n2c_deleted: [],
                        c2n_added: [],
                        c2n_deleted: []
                    });
                }
            });
            CLOUD_SYNC.refresh_list = false;
        })
        .thenResolve();
}

function update_work_list(policy) {
    //order is important, in order to query needed sync objects only once form DB
    //fill the n2c list first

    return Q.when(update_n2c_worklist(policy))
        .then(function() {
            return update_c2n_worklist(policy);
        });
}

//TODO:: SCALE: Limit to batches like the build worker does
function update_n2c_worklist(policy) {
    if (!policy.n2c_enabled) {
        return;
    }

    dbg.log2('update_n2c_worklist sys', policy.system._id, 'bucket', policy.bucket.id);
    return Q.fcall(function() {
            return object_server.list_need_sync(policy.system._id, policy.bucket.id);
        })
        .then(function(res) {
            var ind = _.findIndex(CLOUD_SYNC.work_lists, function(b) {
                return b.sysid === policy.system._id &&
                    b.bucketid === policy.bucket.id;
            });
            CLOUD_SYNC.work_lists[ind].n2c_added = res.added;
            CLOUD_SYNC.work_lists[ind].n2c_deleted = res.deleted;
            dbg.log2('DONE update_n2c_worklist sys', policy.system._id, 'bucket', policy.bucket.id, 'total changes', res.added.length + res.deleted.length);
        })
        .thenResolve();
}

//Update work lists for specific policy
//TODO:: SCALE: Limit to batches like the build worker does
function update_c2n_worklist(policy) {
    if (!policy.c2n_enabled) {
        return;
    }

    dbg.log2('update_c2n_worklist sys', policy.system._id, 'bucket', policy.bucket.id);

    var worklist_ind = _.findIndex(CLOUD_SYNC.work_lists, function(b) {
        return b.sysid === policy.system._id &&
            b.bucketid === policy.bucket.id;
    });
    var current_worklists = CLOUD_SYNC.work_lists[worklist_ind];

    var target = policy.endpoint;
    var params = {
        Bucket: target,
    };

    //Take a list from the cloud, list from the bucket, keep only key and ETag
    //Compare the two for diffs of additions/deletions
    var cloud_object_list, bucket_object_list;
    return Q.ninvoke(policy.s3cloud, 'listObjects', params)
        .fail(function(error) {
            dbg.error('update_c2n_worklist failed to list files from cloud: sys', policy.system._id, 'bucket',
                policy.bucket.id, error, error.stack);
            throw new Error('update_c2n_worklist failed to list files from cloud');
        })
        .then(function(cloud_obj) {
            cloud_object_list = _.map(cloud_obj.Contents, function(obj) {
                return {
                    create_time: obj.LastModified,
                    key: obj.Key
                };
            });
            dbg.log2('update_c2n_worklist cloud_object_list length', cloud_object_list.length);
            return object_server.list_all_objects(policy.system._id, policy.bucket.id);
        })
        .then(function(bucket_obj) {
            bucket_object_list = _.map(bucket_obj, function(obj) {
                return {
                    create_time: obj.create_time,
                    key: obj.key
                };
            });
            dbg.log2('update_c2n_worklist bucket_object_list length', bucket_object_list.length);

            //Diff the arrays
            var diff = diff_worklists(cloud_object_list, bucket_object_list);
            dbg.log2('update_c2n_worklist found ', diff.uniq_a.length + diff.uniq_b.length, 'diffs to resolve');
            /*Now resolve each diff in the following manner:
              Appear On   Appear On   Need Sync         Action
              NooBaa      Cloud       (in N2C list)
              ----------  ----------  -------------     ------
                 T          F             F             Deleted on cloud, add to c2n
                 T          F             T             Ignore, Added on NooBaa, handled in n2c
                 F          T             F             Added on cloud, add to c2n
                 F          T             T             Ignore, Deleted on NooBaa, handled in n2c
                 F          F             -             Can't Appear, not interesting
                 T          T             ?             Overwrite possibility, if dates !=, take latest.
                                                        handled by the comperator sent to diff_worklists

              For need sync purposes, check the N2C worklist for current policy,
              should be filled before the c2n list
            */
            var joint_worklist = current_worklists.n2c_added.concat(current_worklists.n2c_deleted);
            _.each(diff.uniq_b, function(bucket_obj) { //Appear in noobaa and not on cloud
                if (_.findIndex(joint_worklist, function(it) {
                        return it.key === bucket_obj.key;
                    }) === -1) {
                    current_worklists.c2n_deleted.push(bucket_obj);
                }
            });
            _.each(diff.uniq_a, function(cloud_obj) { //Appear in cloud and not on NooBaa
                if (_.findIndex(joint_worklist, function(it) {
                        return it.key === cloud_obj.key;
                    }) === -1) {
                    current_worklists.c2n_added.push(cloud_obj);
                }
            });
        })
        .thenResolve();
}

//sync a single file to the cloud
function sync_single_file_to_cloud(policy, object, target) {
    dbg.log3('sync_single_file_to_cloud', object.key, '->', target + '/' + object.key);

    return Q.ninvoke(policy.s3rver, 'getObject', {
            Bucket: policy.bucket.name,
            Key: object.key,
        })
        .then(function(res) {
            //Read file
            var params = {
                Bucket: target,
                Key: object.key,
                ContentType: object.content_type,
                Body: res.Body
            };

            return Q.ninvoke(policy.s3cloud, 'upload', params)
                .fail(function(err) {
                    dbg.error('Error sync_single_file_to_cloud', object.key, '->', target + '/' + object.key,
                        err, err.stack);
                    throw new Error('Error sync_single_file_to_cloud ' + object.key + ' -> ' + target);
                })
                .then(function() {
                    return object_server.mark_cloud_synced(object);
                });
        });
}

//Perform n2c cloud sync for a specific policy with a given work list
function sync_to_cloud_single_bucket(bucket_work_lists, policy) {
    dbg.log2('Start sync_to_cloud_single_bucket on work list for policy', pretty_policy(policy));
    if (!bucket_work_lists || !policy) {
        throw new Error('bucket_work_list and bucket_work_list must be provided');
    }

    var target = policy.endpoint;
    //First delete all the deleted objects
    return Q.fcall(function() {
            if (bucket_work_lists.n2c_deleted.length) {
                var params = {
                    Bucket: target,
                    Delete: {
                        Objects: [],
                    },
                };

                _.each(bucket_work_lists.n2c_deleted, function(obj) {
                    params.Delete.Objects.push({
                        Key: obj.key
                    });
                });
                dbg.log2('sync_to_cloud_single_bucket syncing', bucket_work_lists.n2c_deleted.length, 'deletions n2c');
                return Q.ninvoke(policy.s3cloud, 'deleteObjects', params);
            } else {
                dbg.log2('sync_to_cloud_single_bucket syncing deletions n2c, nothing to sync');
                return;
            }
        })
        .fail(function(error) {
            dbg.error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c', error, error.stack);
            throw new Error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c ' + error);
        })
        .then(function() {
            //marked deleted objects as cloud synced
            return Q.all(_.map(bucket_work_lists.n2c_deleted, function(object) {
                return object_server.mark_cloud_synced(object);
            }));
        })
        .then(function() {
            //empty deleted work list jsperf http://jsperf.com/empty-javascript-array
            while (bucket_work_lists.n2c_deleted.length > 0) {
                bucket_work_lists.n2c_deleted.pop();
            }

            if (bucket_work_lists.n2c_added.length) {
                //Now upload the new objects
                return Q.all(_.map(bucket_work_lists.n2c_added, function(object) {
                    return sync_single_file_to_cloud(policy, object, target);
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
        })
        .thenResolve();
}

//Perform c2n cloud sync for a specific policy with a given work list
function sync_from_cloud_single_bucket(bucket_work_lists, policy) {
    console.error('NBNB:: sync_from_cloud_single_bucket c2n lists are \ndeleted', bucket_work_lists.c2n_deleted, '\nadded', bucket_work_lists.c2n_added);
    dbg.log2('Start sync_from_cloud_single_bucket on work list for policy', pretty_policy(policy));
    if (!bucket_work_lists || !policy) {
        throw new Error('bucket_work_list and bucket_work_list must be provided');
    }

    //TODO:: move to a function which is called both by sync_from_cloud_single_bucket and from sync_to_cloud_single_bucket
    return Q.fcall(function() {
            if (bucket_work_lists.c2n_deleted.length) {
                var params = {
                    Bucket: policy.bucket.name,
                    Delete: {
                        Objects: [],
                    },
                };

                _.each(bucket_work_lists.c2n_deleted, function(obj) {
                    params.Delete.Objects.push({
                        Key: obj.key
                    });
                });
                dbg.log2('sync_from_cloud_single_bucket syncing', bucket_work_lists.c2n_deleted.length, 'deletions c2n', params);
                return Q.ninvoke(policy.s3rver, 'deleteObjects', params);
            } else {
                dbg.log2('sync_to_cloud_single_bucket syncing deletions c2n, nothing to sync');
                return;
            }
        })
        .fail(function(err) {
            dbg.error('sync_from_cloud_single_bucket failed on syncing deletions', err, err.stack);
        })
        .then(function() {
            //empty deleted work list jsperf http://jsperf.com/empty-javascript-array
            while (bucket_work_lists.c2n_deleted.length > 0) {
                bucket_work_lists.c2n_deleted.pop();
            }
            //Now handle c2n additions
        })
        .thenResolve();
}

function update_bucket_last_sync(sysid, bucketname) {
    return Q.when(db.Bucket
            .find({
                system: sysid,
                name: bucketname,
                deleted: null,
            }).exec())
        .then(function(bucket) {
            return db.Bucket.findOneAndUpdate({
                system: sysid,
                name: bucketname,
                deleted: null,
            }, {
                //Fill the entire cloud_sync object, otherwise its being overwriten
                cloud_sync: {
                    endpoint: bucket[0].cloud_sync.endpoint,
                    access_keys: {
                        access_key: bucket[0].cloud_sync.access_keys.access_key,
                        secret_key: bucket[0].cloud_sync.access_keys.secret_key
                    },
                    schedule_min: bucket[0].cloud_sync.schedule_min,
                    last_sync: new Date(),
                    paused: bucket[0].cloud_sync.paused,
                }
            }).exec();
        });
}

//Cloud Sync Refresher worker
promise_utils.run_background_worker({
    name: 'cloud_sync_refresher',

    run_batch: function() {
        var now = Date.now();

        return Q.fcall(function() {
                dbg.log0('CLOUD_SYNC_REFRESHER:', 'BEGIN');
                ///if policies not loaded, load them now
                if (CLOUD_SYNC.configured_policies.length === 0 || CLOUD_SYNC.refresh_list) {
                    load_configured_policies();
                }
            })
            .then(function() {
                return Q.all(_.map(CLOUD_SYNC.configured_policies, function(policy) {
                    if (((now - policy.last_sync) / 1000 / 60 / 60) > policy.schedule_min &&
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
                    var should_update_time = false;
                    if (!is_empty_sync_worklist(single_bucket)) {
                        should_update_time = true;
                        //TODO:: return here, means previous sync was not done, always set last_sync
                    }
                    //Sync n2c
                    return Q.when(sync_to_cloud_single_bucket(single_bucket, current_policy))
                        .then(function() {
                            //Sync c2n
                            return sync_from_cloud_single_bucket(single_bucket, current_policy);
                        })
                        .fail(function(error) {
                            dbg.error('cloud_sync_refresher failed syncing objects for bucket', single_bucket.sysid, single_bucket.bucketid, 'with', error, error.stack);
                            return;
                        })
                        .then(function() {
                            dbg.log3('Done syncing', current_policy.bucket.name, 'on sys', current_policy.system._id);
                            if (should_update_time) {
                                return update_bucket_last_sync(current_policy.system._id, current_policy.bucket.name);
                            } else {
                                return;
                            }
                        });
                }));
            })
            .fail(function(error) {
                dbg.error('cloud_sync_refresher Failed', error, error.stack);
            })
            .then(function() {
                return Q.fcall(function() {
                    dbg.log0('CLOUD_SYNC_REFRESHER:', 'END');
                    return 10000; //TODO:: NBNB move back to 600000
                });
            });
    }
});

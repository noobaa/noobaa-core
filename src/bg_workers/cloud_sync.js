'use strict';

module.exports = {
    background_worker: background_worker,
    get_policy_status: get_policy_status,
    refresh_policy: refresh_policy,
};

var _ = require('lodash');
var P = require('../util/promise');
var AWS = require('aws-sdk');
var db = require('../server/db');
var system_store = require('../server/stores/system_store');
var dbg = require('../util/debug_module')(__filename);

var CLOUD_SYNC = {
    //Policy was changed, list of policies should be refreshed
    refresh_list: false,

    //Configured policies cache & related objects
    configured_policies: [],

    //works lists (n2c/c2n -> addition/deletion) per each configured cloud synced bucket
    work_lists: [],
};

/*
 *************** Cloud Sync Background Worker & Other Eports
 */
function background_worker() {
    var should_update_time = false;
    return P.fcall(function() {
            dbg.log0('CLOUD_SYNC_REFRESHER:', 'BEGIN');
            ///if policies not loaded, load them now
            if (CLOUD_SYNC.configured_policies.length === 0 || CLOUD_SYNC.refresh_list) {
                return load_configured_policies();
            }
        })
        .then(function() {
            var now = Date.now();
            return P.all(_.map(CLOUD_SYNC.configured_policies, function(policy) {
                //If refresh time
                if (((now - policy.last_sync) / 1000 / 60) > policy.schedule_min &&
                    !policy.paused) {
                    var cur_work_list = _.find(CLOUD_SYNC.work_lists, function(wl) {
                        return wl.sysid === policy.system._id &&
                            wl.bucketid === policy.bucket._id;
                    });
                    //If currently still in sync from lasy refresh, skip
                    if (!is_empty_sync_worklist(cur_work_list)) {
                        dbg.log0('Last sync was not finished for', policy.system._id, policy.bucket._id, 'skipping current cycle');
                        return;
                    }
                    should_update_time = true;
                    return update_work_list(policy);
                }
            }));
        })
        .then(function() {
            return P.all(_.map(CLOUD_SYNC.work_lists, function(single_bucket) {
                var current_policy = _.find(CLOUD_SYNC.configured_policies, function(p) {
                    return p.system._id === single_bucket.sysid &&
                        p.bucket._id === single_bucket.bucketid;
                });
                //Sync n2c
                return P.when(sync_to_cloud_single_bucket(single_bucket, current_policy))
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
                            current_policy.last_sync = new Date();
                            return update_bucket_last_sync(current_policy.bucket);
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
            dbg.log0('CLOUD_SYNC_REFRESHER:', 'END');
            return 60000; //TODO:: Different time interval ?
        });
}

function get_policy_status(req) {
    dbg.log3('get policy status', req.rpc_params.bucketid, req.rpc_params.sysid);
    var work_list = _.find(CLOUD_SYNC.work_lists, function(wl) {
        return wl.sysid.toString() === req.rpc_params.sysid &&
            wl.bucketid.toString() === req.rpc_params.bucketid.toString();
    });

    var status, health;

    if (!is_empty_sync_worklist(work_list)) {
        status = 'SYNCING';
    } else {
        status = 'IDLE';
    }

    var policy = _.find(CLOUD_SYNC.configured_policies, function(p) {
        return (p.system._id.toString() === req.rpc_params.sysid &&
            p.bucket._id.toString() === req.rpc_params.bucketid.toString());
    });
    if (policy) {
        health = policy.health;
    } else {
        health = false;
    }

    return {
        status: status,
        health: health
    };
}

function refresh_policy(req) {
    dbg.log2('refresh policy', req.rpc_params.bucketid, req.rpc_params.sysid, req.rpc_params.force_stop);
    var policy = _.find(CLOUD_SYNC.configured_policies, function(p) {
        return (p.system._id.toString() === req.rpc_params.sysid &&
            p.bucket._id.toString() === req.rpc_params.bucketid.toString());
    });
    if (!policy && !req.rpc_params.bucket_deleted) {
        dbg.log0('policy not found, loading it');
        return system_store.refresh().then(function() {
            load_single_policy(system_store.data.get_by_id(req.rpc_params.bucketid));
        });
    }

    if (req.rpc_params.force_stop) {
        var cur_work_list = _.find(CLOUD_SYNC.work_lists, function(wl) {
            return wl.sysid.toString() === req.rpc_params.sysid &&
                wl.bucketid.toString() === req.rpc_params.bucketid;
        });
        if (!is_empty_sync_worklist(cur_work_list)) {
            while (cur_work_list.n2c_deleted.length > 0) {
                cur_work_list.n2c_deleted.pop();
            }
            while (cur_work_list.n2c_added.length > 0) {
                cur_work_list.n2c_added.pop();
            }
            while (cur_work_list.c2n_deleted.length > 0) {
                cur_work_list.c2n_deleted.pop();
            }
            while (cur_work_list.c2n_added.length > 0) {
                cur_work_list.c2n_added.pop();
            }
        }
    }

    CLOUD_SYNC.refresh_list = true;
}

/*
 *************** General Cloud Sync Utils
 */
function is_empty_sync_worklist(work_list) {
    if (typeof(work_list) === 'undefined') {
        return true;
    }

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
        bucket_id: policy.bucket._id,
        system_id: policy.system._id,
        endpoint: policy.endpoint,
        schedule_min: policy.schedule_min,
        last_sync: policy.last_sync,
        additions_only: policy.additions_only,
        c2n_enabled: policy.c2n_enabled,
        n2c_enabled: policy.n2c_enabled,
    };
}

/*
 *************** ObjectMD DB related
 */

//TODO:: add limit and skip
//Preferably move part of list_objects to a mutual function called by both
function list_all_objects(sysid, bucket) {
    return P.when(db.ObjectMD
            .find({
                system: sysid,
                bucket: bucket,
                deleted: null
            })
            .sort('key')
            .exec())
        .then(function(list) {
            return list;
        });
}

//return all objects which need sync (new and deleted) for sysid, bucketid
function list_need_sync(sysid, bucket) {
    var res = {
        deleted: [],
        added: [],
    };

    return P.when(db.ObjectMD
            .find({
                system: sysid,
                bucket: bucket,
                cloud_synced: false
            })
            .exec())
        .then(function(need_to_sync) {
            _.each(need_to_sync, function(obj) {
                if (typeof(obj.deleted) !== 'undefined') {
                    res.deleted.push(obj);
                } else {
                    res.added.push(obj);
                }
            });
            return res;
        })
        .then(null, function(err) {
            console.warn('list_need_sync got error', err, err.stack);
        });
}

//set cloud_sync to true on given object
function mark_cloud_synced(object) {
    return P.when(db.ObjectMD
            .findOne({
                system: object.system,
                bucket: object.bucket,
                key: object.key,
                //Don't set deleted, since we update both deleted and not
            })
            .exec())
        .then(function(dbobj) {
            return dbobj.update({
                cloud_synced: true
            }).exec();
        });
}



/*
 *************** Cloud Sync Logic
 */
function diff_worklists(wl1, wl2, sync_time) {
    var uniq_1 = [],
        uniq_2 = [];
    var pos1 = 0,
        pos2 = 0;

    var comp = function(a, b, sync_time) {
        if (_.isUndefined(a) && !_.isUndefined(b)) {
            return -1;
        } else if (_.isUndefined(b) && !_.isUndefined(a)) {
            return 1;
        } else if (a.key < b.key) {
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

    while (comp(wl1[pos1], wl2[pos2]) === -1 && pos1 < wl1.length) {
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
    return system_store.refresh().then(function() {
        _.each(system_store.data.buckets, function(bucket, i) {
            if (!bucket.cloud_sync || !bucket.cloud_sync.endpoint) {
                return;
            }
            load_single_policy(bucket);
        });
        CLOUD_SYNC.refresh_list = false;
    });
}

function load_single_policy(bucket) {
    dbg.log3('adding sysid', bucket.system._id, 'bucket', bucket.name, bucket._id, 'bucket', bucket, 'to configured policies');
    //Cache Configuration, S3 Objects and empty work lists
    var policy = {
        bucket: bucket,
        system: bucket.system,
        endpoint: bucket.cloud_sync.endpoint,
        target_bucket: bucket.cloud_sync.target_bucket,
        access_keys: {
            access_key: bucket.cloud_sync.access_keys.access_key,
            secret_key: bucket.cloud_sync.access_keys.secret_key
        },
        schedule_min: bucket.cloud_sync.schedule_min,
        paused: bucket.cloud_sync.paused,
        c2n_enabled: bucket.cloud_sync.c2n_enabled,
        n2c_enabled: bucket.cloud_sync.n2c_enabled,
        last_sync: (bucket.cloud_sync.last_sync) ? bucket.cloud_sync.last_sync : 0,
        additions_only: bucket.cloud_sync.additions_only,
        health: true,
        s3rver: null,
        s3cloud: null,
    };
    //Create a corresponding local bucket s3 object and a cloud bucket object
    policy.s3rver = new AWS.S3({
        endpoint: 'http://127.0.0.1',
        s3ForcePathStyle: true,
        sslEnabled: false,
        accessKeyId: policy.system.owner.access_keys[0].access_key,
        secretAccessKey: policy.system.owner.access_keys[0].secret_key,
        maxRedirects: 10,
    });

    if (policy.endpoint==="https://s3.amazonaws.com"){
        //Amazon S3
        policy.s3cloud = new AWS.S3({
            endpoint: policy.endpoint,
            accessKeyId: policy.access_keys.access_key,
            secretAccessKey: policy.access_keys.secret_key,
            region: 'us-east-1'
        });
    }else{
        //S3 compatible
        policy.s3cloud = new AWS.S3({
            endpoint: policy.endpoint,
            sslEnabled: false,
            s3ForcePathStyle: true,
            accessKeyId: policy.access_keys.access_key,
            secretAccessKey: policy.access_keys.secret_key,
        });

    }

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

function update_work_list(policy) {
    //order is important, in order to query needed sync objects only once form DB
    //fill the n2c list first
    dbg.log3('update_work_list for', pretty_policy(policy));
    return P.when(update_n2c_worklist(policy))
        .then(function() {
            return update_c2n_worklist(policy);
        });
}

//TODO:: SCALE: Limit to batches like the build worker does
function update_n2c_worklist(policy) {
    if (!policy.n2c_enabled) {
        return;
    }

    dbg.log2('update_n2c_worklist sys', policy.system._id, 'bucket', policy.bucket._id);
    return P.fcall(function() {
            return list_need_sync(policy.system._id, policy.bucket._id);
        })
        .then(function(res) {
            var ind = _.findIndex(CLOUD_SYNC.work_lists, function(b) {
                return b.sysid === policy.system._id &&
                    b.bucketid === policy.bucket._id;
            });
            CLOUD_SYNC.work_lists[ind].n2c_added = res.added;
            if (policy.additions_only) {
                dbg.log2('update_n2c_worklist not adding deletions');
            } else {
                CLOUD_SYNC.work_lists[ind].n2c_deleted = res.deleted;
            }
            dbg.log2('DONE update_n2c_worklist sys', policy.system._id, 'bucket', policy.bucket._id, 'total changes', res.added.length + res.deleted.length);
        })
        .thenResolve();
}

//Update work lists for specific policy
//TODO:: SCALE: Limit to batches like the build worker does
function update_c2n_worklist(policy) {
    if (!policy.c2n_enabled) {
        return;
    }

    dbg.log2('update_c2n_worklist sys', policy.system._id, 'bucket', policy.bucket._id);

    var worklist_ind = _.findIndex(CLOUD_SYNC.work_lists, function(b) {
        return b.sysid === policy.system._id &&
            b.bucketid === policy.bucket._id;
    });
    var current_worklists = CLOUD_SYNC.work_lists[worklist_ind];

    var target = policy.target_bucket;
    var params = {
        Bucket: target,
    };

    //Take a list from the cloud, list from the bucket, keep only key and ETag
    //Compare the two for diffs of additions/deletions
    var cloud_object_list, bucket_object_list;
    return P.ninvoke(policy.s3cloud, 'listObjects', params)
        .fail(function(error) {
            dbg.error('ERROR statusCode', error.statusCode, error.statusCode === 400, error.statusCode === 301);
            if (error.statusCode === 400 ||
                error.statusCode === 301) {
                dbg.log0('Resetting (list objects) signature type and region to eu-central-1 and v4', params);
                // change default region from US to EU due to restricted signature of v4 and end point
                //TODO: maybe we should add support here for cloud sync from noobaa to noobaa after supporting v4.
                policy.s3cloud = new AWS.S3({
                    accessKeyId: policy.access_keys.access_key,
                    secretAccessKey: policy.access_keys.secret_key,
                    signatureVersion: 'v4',
                    region: 'eu-central-1'
                });
                return P.ninvoke(policy.s3cloud, 'listObjects', params)
                    .fail(function(err) {
                        dbg.error('update_c2n_worklist failed to list files from cloud: sys', policy.system._id, 'bucket',
                            policy.bucket.id, error, error.stack);
                        throw new Error('update_c2n_worklist failed to list files from cloud');
                    });
            } else {
                dbg.error('update_c2n_worklist failed to list files from cloud: sys', policy.system._id, 'bucket',
                    policy.bucket.id, error, error.stack);
                throw new Error('update_c2n_worklist failed to list files from cloud');
            }
        })
        .then(function(cloud_obj) {
            cloud_object_list = _.map(cloud_obj.Contents, function(obj) {
                return {
                    create_time: obj.LastModified,
                    key: obj.Key
                };
            });
            dbg.log2('update_c2n_worklist cloud_object_list length', cloud_object_list.length);
            return list_all_objects(policy.system._id, policy.bucket._id);
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
            let sorted_cloud_object_list = _.sortBy(cloud_object_list, function(o) {
                return o.key;
            });
            var diff = diff_worklists(sorted_cloud_object_list, bucket_object_list);
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
            if (!policy.additions_only) {
                _.each(diff.uniq_b, function(bucket_obj) { //Appear in noobaa and not on cloud
                    if (_.findIndex(joint_worklist, function(it) {
                            return it.key === bucket_obj.key;
                        }) === -1) {
                        current_worklists.c2n_deleted.push(bucket_obj);
                    }
                });
            } else {
                dbg.log2('update_c2n_worklist not adding deletions');
            }
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

    var body = policy.s3rver.getObject({
        Bucket: policy.bucket.name,
        Key: object.key,
    }).createReadStream();

    var params = {
        Bucket: target,
        Key: object.key,
        Body: body
    };

    return P.ninvoke(policy.s3cloud, 'upload', params)
        .fail(function(err) {
            dbg.error('Error sync_single_file_to_cloud', object.key, '->', target + '/' + object.key,
                err, err.stack);
            throw new Error('Error sync_single_file_to_cloud ' + object.key + ' -> ' + target);
        })
        .then(function() {
            return mark_cloud_synced(object);
        });
}

//sync a single file to NooBaa
function sync_single_file_to_noobaa(policy, object) {
    dbg.log3('sync_single_file_to_noobaa', object.key, '->', policy.bucket.name + '/' + object.key);

    var body = policy.s3cloud.getObject({
        Bucket: policy.target_bucket,
        Key: object.key,
    }).createReadStream();

    var params = {
        Bucket: policy.bucket.name,
        Key: object.key,
        ContentType: object.content_type,
        Body: body
    };

    return P.ninvoke(policy.s3rver, 'upload', params)
        .fail(function(err) {
            dbg.error('ERROR statusCode', err.statusCode, err.statusCode === 400, err.statusCode === 301);
            if (err.statusCode === 400 ||
                err.statusCode === 301) {
                //TODO: maybe we should add support here for cloud sync from noobaa to noobaa after supporting v4.
                dbg.log0('Resetting (upload) signature type and region to eu-central-1 and v4');
                policy.s3cloud = new AWS.S3({
                    accessKeyId: policy.access_keys.access_key,
                    secretAccessKey: policy.access_keys.secret_key,
                    signatureVersion: 'v4',
                    region: 'eu-central-1'
                });
                return P.ninvoke(policy.s3cloud, 'upload', params)
                    .fail(function(err) {
                        dbg.error('Error sync_single_file_to_noobaa', object.key, '->', policy.bucket.name + '/' + object.key,
                            err, err.stack);
                        throw new Error('Error sync_single_file_to_noobaa ' + object.key, '->', policy.bucket.name);
                    });
            } else {
                dbg.error('Error sync_single_file_to_noobaa', object.key, '->', policy.bucket.name + '/' + object.key,
                    err, err.stack);
                throw new Error('Error sync_single_file_to_noobaa ' + object.key, '->', policy.bucket.name);
            }
        })
        .then(function() {
            return;
        });
}

//Perform n2c cloud sync for a specific policy with a given work list
function sync_to_cloud_single_bucket(bucket_work_lists, policy) {
    dbg.log2('Start sync_to_cloud_single_bucket on work list for policy', pretty_policy(policy));
    if (!bucket_work_lists || !policy) {
        throw new Error('bucket_work_list and bucket_work_list must be provided');
    }

    var target = policy.target_bucket;
    //First delete all the deleted objects
    return P.fcall(function() {
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
                return P.ninvoke(policy.s3cloud, 'deleteObjects', params)
                    .fail(function(err) {
                        // change default region from US to EU due to restricted signature of v4 and end point
                        if (err.statusCode === 400 ||
                            err.statusCode === 301) {
                            dbg.log0('Resetting (delete) signature type and region to eu-central-1 and v4');
                            //TODO: maybe we should add support here for cloud sync from noobaa to noobaa after supporting v4.
                            policy.s3cloud = new AWS.S3({
                                accessKeyId: policy.access_keys.access_key,
                                secretAccessKey: policy.access_keys.secret_key,
                                signatureVersion: 'v4',
                                region: 'eu-central-1'
                            });
                            return P.ninvoke(policy.s3cloud, 'deleteObjects', params)
                                .fail(function(err) {
                                    dbg.error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c', err, err.stack);
                                    throw new Error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c ' + err);
                                });
                        } else {
                            dbg.error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c', err, err.stack);
                            throw new Error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c ' + err);
                        }
                    });
            } else {
                dbg.log2('sync_to_cloud_single_bucket syncing deletions n2c, nothing to sync');
                return;
            }
        })
        .then(function() {
            //marked deleted objects as cloud synced
            return P.all(_.map(bucket_work_lists.n2c_deleted, function(object) {
                return mark_cloud_synced(object);
            }));
        })
        .then(function() {
            //empty deleted work list jsperf http://jsperf.com/empty-javascript-array
            while (bucket_work_lists.n2c_deleted.length > 0) {
                bucket_work_lists.n2c_deleted.pop();
            }

            if (bucket_work_lists.n2c_added.length) {
                //Now upload the new objects
                return P.all(_.map(bucket_work_lists.n2c_added, function(object) {
                        return sync_single_file_to_cloud(policy, object, target);
                    }))
                    .then(function() {
                        //empty added work list jsperf http://jsperf.com/empty-javascript-array
                        dbg.log2('clearing n2c_added work_list');
                        while (bucket_work_lists.n2c_added.length > 0) {
                            bucket_work_lists.n2c_added.pop();
                        }
                    });
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
    dbg.log2('Start sync_from_cloud_single_bucket on work list for policy', pretty_policy(policy));
    if (!bucket_work_lists || !policy) {
        throw new Error('bucket_work_list and bucket_work_list must be provided');
    }

    //TODO:: move to a function which is called both by sync_from_cloud_single_bucket and from sync_to_cloud_single_bucket
    return P.fcall(function() {
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
                return P.ninvoke(policy.s3rver, 'deleteObjects', params);
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
            //now handle c2n additions
            if (bucket_work_lists.c2n_added.length) {
                //Now upload the new objects to NooBaa
                return P.all(_.map(bucket_work_lists.c2n_added, function(object) {
                    return sync_single_file_to_noobaa(policy, object);
                }));
            } else {
                dbg.log1('sync_from_cloud_single_bucket syncing additions c2n, nothing to sync');
            }
        })
        .fail(function(error) {
            dbg.error('sync_from_cloud_single_bucket Failed syncing added objects c2n', error, error.stack);
        })
        .then(function() {
            //TODO:: pop per file
            while (bucket_work_lists.c2n_added.length > 0) {
                bucket_work_lists.c2n_added.pop();
            }
            dbg.log1('Done sync_from_cloud_single_bucket on {', policy.bucket.name, policy.system._id, policy.endpoint, '}');
        })
        .thenResolve();
}

function update_bucket_last_sync(bucket) {
    return system_store.make_changes({
        update: {
            buckets: [{
                _id: bucket._id,
                'cloud_sync.last_sync': new Date()
            }]
        }
    });
}

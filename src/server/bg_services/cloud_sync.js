/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const util = require('util');
const https = require('https');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');

class PolicyMap extends Map {
    static create() {
        return Object.setPrototypeOf(new Map(), new PolicyMap());
    }
    set_policy(key, value) {
        this.set(_policy_identifier(key), value);
    }
    get_policy(key) {
        return this.get(_policy_identifier(key));
    }
    delete_policy(key) {
        this.delete(_policy_identifier(key));
    }
    to_array() {
        return Array.from(this.values());
    }
}

const CLOUD_SYNC = {
    //Configured policies cache & related objects
    configured_policies: PolicyMap.create()
};

/*
 *************** Cloud Sync Background Worker & Other Eports
 */
function background_worker() {
    dbg.log0('CLOUD_SYNC_REFRESHER:', 'BEGIN');

    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return P.resolve();
    }

    let now = new Date();
    return load_policies()
        .then(() => P.all(_.map(_.filter(CLOUD_SYNC.configured_policies.to_array(), policy =>
                (((now - policy.last_sync) / 1000 / 60) > policy.schedule_min &&
                    !policy.paused &&
                    policy.status !== 'SYNCING' &&
                    policy.status !== 'NOTSET'
                )), policy => update_work_list(policy)
            .then(() => {
                if (_are_worklists_empty(policy)) {
                    policy.health = true;
                    return _mark_as_done(policy);
                }
                policy.status = 'PENDING';
            })
            .catch(err => {
                policy.health = false;
                policy.status = 'UNABLE';
                dbg.error('Could not update work_lists for policy ', pretty_policy(policy), err.stack || err);
            }))))
        .then(() => P.all(_.map(_.filter(CLOUD_SYNC.configured_policies.to_array(), policy =>
            !policy.paused &&
            policy.status === 'PENDING'), policy => {
            policy.status = 'SYNCING';
            policy.health = true;
            return P.resolve(sync_to_cloud_single_bucket(policy))
                .then(() => sync_from_cloud_single_bucket(policy))
                .then(() => _mark_as_done(policy))
                .catch(function(error) {
                    dbg.error('cloud_sync_refresher failed syncing objects for bucket',
                        policy.bucket.sysid, policy.bucket.bucketid,
                        'with', error, error.stack);
                    policy.health = false;
                    policy.status = 'UNABLE';
                });
        })))
        .catch(function(error) {
            dbg.error('cloud_sync_refresher Failed', error, error.stack);
        })
        .then(function() {
            dbg.log0('CLOUD_SYNC_REFRESHER:', 'END');
            return 60000; //TODO:: Different time interval ?
        });
}

function get_policy_status(req) {
    dbg.log3('get policy status', req.rpc_params.bucketid, req.rpc_params.sysid);
    let policy;
    return load_policies().then(() => {
        policy = CLOUD_SYNC.configured_policies.get_policy(req.rpc_params);
        return policy ? {
            status: policy.status,
            health: policy.health
        } : {
            status: 'NOTSET',
            health: true
        };
    });
}

function refresh_policy(req) {
    dbg.log2('refresh policy', req.rpc_params);
    return load_policies()
        .then(() => P.fcall(() =>
            load_single_policy(req.rpc_params.bucket_id, req.rpc_params.system_id)))
        .return();
}

/*
 *************** General Cloud Sync Utils
 */

function _policy_identifier(policy) {
    const system_id = _.get(policy, 'system._id') || // Policy 'object'
        policy.sysid;
    const bucket_id = _.get(policy, 'bucket._id') ||
        policy.bucketid;
    if (!system_id || !bucket_id) {
        dbg.error('Invalid policy: ', policy);
        throw new Error('Invalid policy received');
    }
    return `${system_id.toString()}_${bucket_id.toString()}`;
}

function load_policies() {
    if (CLOUD_SYNC.configured_policies.size) {
        return P.resolve(CLOUD_SYNC.configured_policies);
    }
    return system_store.refresh()
        .then(() => P.all(
            _.map(system_store.data.buckets, bucket => {
                if (bucket.cloud_sync && bucket.cloud_sync.endpoint) {
                    return P.fcall(() => load_single_policy(bucket._id));
                }
                return P.resolve();
            })))
        .then(() => CLOUD_SYNC.configured_policies);
}

function _mark_as_done(policy, date) {
    if (!_are_worklists_empty(policy)) {
        throw new Error('Sync did not complete as expected');
    }
    let now = date || new Date();
    policy.status = 'SYNCED';
    policy.last_sync = now;
    return update_bucket_last_sync(policy.bucket, now);
}

function _are_worklists_empty(policy) {
    return !(
        policy.work_lists.n2c_deleted.length ||
        policy.work_lists.n2c_added.length ||
        policy.work_lists.c2n_deleted.length ||
        policy.work_lists.c2n_added.length);
}

//return pretty (printable) policy obj
function pretty_policy(policy) {
    return _.pick(policy, [
        'bucket',
        'system',
        'endpoint',
        'schedule_min',
        'last_sync',
        'additions_only',
        'c2n_enabled',
        'n2c_enabled',
        'work_lists'
    ]);
}

/*
 *************** ObjectMD DB related
 */

//TODO:: add limit and skip
//Preferably move part of list_objects to a mutual function called by both
function list_all_objects(sysid, bucket) {
    return MDStore.instance().list_all_objects_of_bucket_ordered_by_key(bucket);
}

//return all objects which need sync (new and deleted) for sysid, bucketid
function list_need_sync(bucket) {
    var res = {
        deleted: [],
        added: [],
    };

    return MDStore.instance().list_all_objects_of_bucket_need_sync(bucket)
        .then(need_to_sync => {
            _.each(need_to_sync, obj => {
                if (obj.deleted) {
                    if (!(res.deleted.find(deleted_obj => (
                            deleted_obj.system._id === obj.system._id &&
                            deleted_obj.bucket._id === obj.bucket._id &&
                            deleted_obj.key === obj.key
                        )))) {
                        res.deleted.push(obj);
                    }
                } else {
                    res.added.push(obj);
                }
            });
            return res;
        })
        .catch(err => {
            console.warn('list_need_sync got error', err, err.stack);
        });
}

// set cloud_sync to true on given object
function mark_cloud_synced(object) {
    return MDStore.instance().update_object_by_key(object.bucket, object.key, {
        cloud_synced: true
    });
}

// set cloud_sync to true on given object
function mark_cloud_synced_deleted(object) {
    return MDStore.instance().update_objects_by_key_deleted(object.bucket, object.key, {
        cloud_synced: true
    });
}



/*
 *************** Cloud Sync Logic
 */
function diff_worklists(wl1, wl2, sync_time) {
    var uniq_1 = [];
    var uniq_2 = [];
    var pos1 = 0;
    var pos2 = 0;

    var comp = function(a, b, sync_time) {
        if (_.isUndefined(a) && !_.isUndefined(b)) {
            return -1;
        } else if (_.isUndefined(b) && !_.isUndefined(a)) {
            return 1;
        } else if (a.key < b.key) {
            return -1;
        } else if (a.key > b.key) {
            return 1;
        } else if (a.create_time > sync_time) {
            return 2;
        } else if (b.create_time > sync_time) {
            return -2;
        } else {
            return 0;
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

    dbg.log4('diff_arrays recieved wl1 #', wl1.length, 'wl2 #', wl2.length,
        'returns uniq_1', uniq_1, 'uniq_2', uniq_2);

    return {
        uniq_a: uniq_1,
        uniq_b: uniq_2
    };
}

function load_single_policy(bucket_id, system_id) {
    if (!bucket_id) {
        dbg.error(`No bucket id received for load_single_policy`);
        throw new Error('Attempted to load Invalid policy');
    }

    const bucket = system_store.data.get_by_id(bucket_id);
    // We expect to get system_id here in the case that the bucket was deleted.
    if (!bucket && !system_id) {
        dbg.error(`Attempt to load a policy failed. The bucket does not exist and no system_id was passed`);
        throw new Error('Attempted to load Invalid policy');
    }
    const policy_id = {
        sysid: system_id || (bucket && bucket.system._id.toString()),
        bucketid: bucket_id.toString()
    };

    if (!policy_id.sysid) {
        dbg.error(`No system id received for load_single_policy`);
        throw new Error('Attempted to load Invalid policy');
    }

    if (!bucket || !bucket.cloud_sync) {
        return CLOUD_SYNC.configured_policies.delete_policy(policy_id);
    }

    dbg.log3('adding sysid', bucket.system._id, 'bucket', bucket.name, bucket._id,
        'bucket', bucket, 'to configured policies');
    let stored_policy = CLOUD_SYNC.configured_policies.get_policy(policy_id);

    var policy = {
        endpoint: bucket.cloud_sync.endpoint,
        bucket: {
            name: bucket.name,
            _id: bucket._id
        },
        system: {
            _id: bucket.system._id
        },
        target_bucket: bucket.cloud_sync.target_bucket,
        access_keys: {
            access_key: bucket.cloud_sync.access_keys.access_key,
            secret_key: bucket.cloud_sync.access_keys.secret_key
        },
        schedule_min: bucket.cloud_sync.schedule_min,
        paused: bucket.cloud_sync.paused,
        c2n_enabled: bucket.cloud_sync.c2n_enabled,
        n2c_enabled: bucket.cloud_sync.n2c_enabled,
        last_sync: bucket.cloud_sync.last_sync || 0,
        additions_only: bucket.cloud_sync.additions_only,
        health: true,
        s3rver: null,
        s3cloud: null,
        status: (stored_policy && stored_policy.status) || 'PENDING',
        work_lists: {
            n2c_added: [],
            n2c_deleted: [],
            c2n_added: [],
            c2n_deleted: []
        }
    };
    //Create a corresponding local bucket s3 object and a cloud bucket object
    policy.s3rver = new AWS.S3({
        endpoint: 'https://127.0.0.1',
        s3ForcePathStyle: true,
        accessKeyId: bucket.system.owner.access_keys[0].access_key,
        secretAccessKey: bucket.system.owner.access_keys[0].secret_key,
        maxRedirects: 10,
        httpOptions: {
            agent: new https.Agent({
                rejectUnauthorized: false,
            })
        }
    });

    if (policy.endpoint === "https://s3.amazonaws.com") {
        //Amazon S3
        policy.s3cloud = new AWS.S3({
            endpoint: policy.endpoint,
            accessKeyId: policy.access_keys.access_key,
            secretAccessKey: policy.access_keys.secret_key,
            region: 'us-east-1'
        });
    } else {
        //S3 compatible
        policy.s3cloud = new AWS.S3({
            endpoint: policy.endpoint,
            s3ForcePathStyle: true,
            accessKeyId: policy.access_keys.access_key,
            secretAccessKey: policy.access_keys.secret_key,
            httpOptions: {
                agent: new https.Agent({
                    rejectUnauthorized: false,
                })
            }
        });

    }
    if (stored_policy) {
        Object.assign(stored_policy, policy);
    } else {
        CLOUD_SYNC.configured_policies.set_policy(policy, policy);
    }
}

function update_work_list(policy) {
    //order is important, in order to query needed sync objects only once form DB
    //fill the n2c list first
    dbg.log3('update_work_list for', pretty_policy(policy));
    return update_n2c_worklist(policy)
        .then(() => update_c2n_worklist(policy));
}

//TODO:: SCALE: Limit to batches like the build worker does
function update_n2c_worklist(policy) {
    if (!policy.n2c_enabled) {
        return P.resolve();
    }
    dbg.log2('update_n2c_worklist sys', policy.system._id, 'bucket', policy.bucket._id);
    return P.fcall(function() {
            return list_need_sync(policy.bucket._id);
        })
        .then(function(res) {
            policy.work_lists.n2c_added = res.added;
            if (policy.additions_only) {
                dbg.log2('update_n2c_worklist not adding deletions');
            } else {
                policy.work_lists.n2c_deleted = res.deleted;
            }
            dbg.log2('DONE update_n2c_worklist sys', policy.system._id,
                'bucket', policy.bucket._id,
                'total changes', res.added.length + res.deleted.length);
        })
        .return();
}

//Update work lists for specific policy
//TODO:: SCALE: Limit to batches like the build worker does
function update_c2n_worklist(policy) {
    if (!policy.c2n_enabled) {
        return P.resolve();
    }
    dbg.log2('update_c2n_worklist sys', policy.system._id, 'bucket', policy.bucket._id);

    let work_list = policy.work_lists;

    var target = policy.target_bucket;
    var params = {
        Bucket: target,
    };

    //Take a list from the cloud, list from the bucket, keep only key and ETag
    //Compare the two for diffs of additions/deletions
    var cloud_object_list;
    var bucket_object_list;

    // Initialization of IsTruncated in order to perform the first while cycle
    var listObjectsResponse = {
        IsTruncated: true,
        Contents: []
    };

    return promise_utils.pwhile(
            function() {
                return listObjectsResponse.IsTruncated;
            },
            function() {
                listObjectsResponse.IsTruncated = false;
                return P.ninvoke(policy.s3cloud, 'listObjects', params)
                    .catch(function(error) {
                        dbg.error('ERROR statusCode', error.statusCode,
                            error.statusCode === 400, error.statusCode === 301);
                        if (error.statusCode === 400 ||
                            error.statusCode === 301) {
                            dbg.log0('Resetting (list objects) signature type to v4', params);
                            // change default region from US to EU due to restricted signature of v4 and end point
                            //TODO: maybe we should add support here for cloud sync from noobaa to noobaa after supporting v4.
                            policy.s3cloud = new AWS.S3({
                                accessKeyId: policy.access_keys.access_key,
                                secretAccessKey: policy.access_keys.secret_key,
                                signatureVersion: 'v4',
                            });
                            return P.ninvoke(policy.s3cloud, 'listObjects', params)
                                .catch(function(err) {
                                    dbg.error('update_c2n_worklist failed to list files from cloud: sys',
                                        policy.system._id, 'bucket', policy.bucket.id, error, error.stack);
                                    throw new Error('update_c2n_worklist failed to list files from cloud');
                                });
                        } else {
                            dbg.error('update_c2n_worklist failed to list files from cloud: sys',
                                policy.system._id, 'bucket', policy.bucket.id, error, error.stack);
                            throw new Error('update_c2n_worklist failed to list files from cloud');
                        }
                    })
                    .then(function(res) {
                        listObjectsResponse.IsTruncated = res.IsTruncated;
                        let list = res.Contents;
                        if (list.length) {
                            listObjectsResponse.Contents = _.concat(listObjectsResponse.Contents, list);
                            params.Marker = list[list.length - 1].Key;
                        }
                    });
            })
        .then(function() {
            cloud_object_list = _.map(listObjectsResponse.Contents, function(obj) {
                return {
                    create_time: obj.LastModified,
                    key: obj.Key,
                    orig_md: {
                        obj
                    }
                };
            });
            dbg.log2('update_c2n_worklist cloud_object_list length', cloud_object_list.length);
            return list_all_objects(policy.bucket._id);
        })
        .then(function(bucket_obj) {
            bucket_object_list = _.map(bucket_obj, function(obj) {
                return {
                    create_time: obj.create_time,
                    key: obj.key,
                    orig_md: {
                        obj
                    }
                };
            });
            dbg.log2('update_c2n_worklist bucket_object_list length', bucket_object_list.length);

            //Diff the arrays
            let sorted_cloud_object_list = _.sortBy(cloud_object_list, function(o) {
                return o.key;
            });
            var diff = diff_worklists(sorted_cloud_object_list, bucket_object_list, policy.last_sync);
            dbg.log2('update_c2n_worklist found',
                diff.uniq_a.length + diff.uniq_b.length, 'diffs to resolve');

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
            var joint_worklist = work_list.n2c_added.concat(work_list.n2c_deleted);
            if (!policy.additions_only) {
                _.each(diff.uniq_b, function(bucket_obj) { //Appear in noobaa and not on cloud
                    if (_.findIndex(joint_worklist, function(it) {
                            return it.key === bucket_obj.key;
                        }) === -1) {
                        work_list.c2n_deleted.push(bucket_obj);
                    }
                });
            } else {
                dbg.log2('update_c2n_worklist not adding deletions');
            }
            _.each(diff.uniq_a, function(cloud_obj) { //Appear in cloud and not on NooBaa
                if (_.findIndex(joint_worklist, function(it) {
                        return it.key === cloud_obj.key;
                    }) === -1) {
                    work_list.c2n_added.push(cloud_obj);
                }
            });
        })
        .return();
}

//sync a single file to the cloud
function sync_single_file_to_cloud(policy, object, target) {
    dbg.log3('sync_single_file_to_cloud', object.key, '->', target + '/' + object.key);

    const read_request = policy.s3rver.getObject({
        Bucket: policy.bucket.name,
        Key: object.key,
    });
    const body = read_request.createReadStream();

    //Take all MD as is, and only overwrite what is needed
    var params = _.omit(object.orig_md, [
        '_id',
        'stats',
        '__v',
        'cloud_synced',
        'bucket',
        'system',
        'key',
    ]);
    params.Key = object.key;
    params.Bucket = target;
    params.Body = body;

    let managed_upload = policy.s3cloud.upload(params);
    return P.join(promise_utils.wait_for_event(body, 'end'),
            managed_upload.promise())
        .catch(function(err) {
            dbg.error('ERROR ', err, ' statusCode', err.statusCode, err.statusCode === 400, err.statusCode === 301);
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
                managed_upload = policy.s3cloud.upload(params);
                return P.join(promise_utils.wait_for_event(body, 'end'),
                        managed_upload.promise())
                    .catch(function(err2) {
                        managed_upload.abort();
                        read_request.abort();
                        dbg.error('Error (upload) sync_single_file_to_cloud', object.key, '->', policy.bucket.name + '/' + object.key,
                            err2, err2.stack);
                        throw new Error('Failed to sync file from NooBaa to cloud');
                    });
            }
            managed_upload.abort();
            read_request.abort();
            dbg.error('Error sync_single_file_to_cloud', object.key, '->', policy.bucket.name + '/' + object.key,
                err, err.stack);
            throw new Error('Failed to sync file from NooBaa to cloud');
        })
        .then(function() {
            return mark_cloud_synced(object);
        });
}

//sync a single file to NooBaa
function sync_single_file_to_noobaa(policy, object) {
    dbg.log3('sync_single_file_to_noobaa', object.key, '->', policy.bucket.name + '/' + object.key);

    let download_request = policy.s3cloud.getObject({
        Bucket: policy.target_bucket,
        Key: object.key,
    });

    let body = download_request.createReadStream();

    //Take all MD as is, and only overwrite what is needed
    var params = object.orig_md;
    params.Key = object.key;
    params.Bucket = policy.bucket.name;
    params.Body = body;

    let managed_download = policy.s3rver.upload(params);
    return P.join(promise_utils.wait_for_event(body, 'end'),
            managed_download.promise())
        .catch(function(err) {
            managed_download.abort();
            download_request.abort();
            // on any error just continue to the next file
            dbg.error('Error sync_single_file_to_noobaa', object.key, '->', policy.bucket.name + '/' + object.key,
                err, err.stack);
        })
        .then(() => mark_cloud_synced(object))
        .return();
}

//Perform n2c cloud sync for a specific policy with a given work list
function sync_to_cloud_single_bucket(policy) {

    dbg.log2('Start sync_to_cloud_single_bucket on work list for policy', pretty_policy(policy));
    if (!policy) {
        throw new Error('bucket_work_list and bucket_work_list must be provided');
    }
    var bucket_work_lists = policy.work_lists;
    var target = policy.target_bucket;
    //First delete all the deleted objects
    return P.fcall(function() {
            if (!bucket_work_lists.n2c_deleted.length) {
                dbg.log2('sync_to_cloud_single_bucket syncing deletions n2c, nothing to sync');
                return;
            }

            let params_array = [{
                Bucket: target,
                Delete: {
                    Objects: [],
                },
            }];

            const MAX_SIZE_OF_DEL_REQUEST = 500;
            let request_idx = 0;
            _.each(bucket_work_lists.n2c_deleted, function(obj) {
                if (params_array[request_idx].Delete.Objects.length >= MAX_SIZE_OF_DEL_REQUEST) {
                    request_idx += 1;
                    dbg.log0(`sync_to_cloud_single_bucket over ${MAX_SIZE_OF_DEL_REQUEST * request_idx} objects to delete`);
                    params_array[request_idx] = {
                        Bucket: target,
                        Delete: {
                            Objects: [],
                        },
                    };
                }
                params_array[request_idx].Delete.Objects.push({
                    Key: obj.key
                });
            });
            dbg.log2('sync_to_cloud_single_bucket syncing',
                bucket_work_lists.n2c_deleted.length,
                'deletions n2c with params',
                util.inspect(params_array, {
                    depth: null
                })
            );
            return P.resolve()
                .then(() => P.all(_.each(params_array, params =>
                    P.ninvoke(policy.s3cloud, 'deleteObjects', params)
                    .catch(function(err) {
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
                                .catch(function(err) {
                                    dbg.error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c', err, err.stack);
                                    throw new Error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c ' + err);
                                });
                        } else {
                            dbg.error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c', err, err.stack);
                            throw new Error('sync_to_cloud_single_bucket Failed syncing deleted objects n2c ' + err);
                        }
                    }))));
        })
        .then(function() {
            //marked deleted objects as cloud synced
            return P.all(_.map(bucket_work_lists.n2c_deleted, function(object) {
                return mark_cloud_synced_deleted(object);
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
        .catch(function(error) {
            policy.health = false;
            dbg.error('sync_to_cloud_single_bucket Failed syncing added objects n2c', error, error.stack);
        })
        .then(function() {
            dbg.log1('Done sync_to_cloud_single_bucket on {', policy.bucket.name, policy.system._id, policy.endpoint, '}');
        })
        .return();
}

//Perform c2n cloud sync for a specific policy with a given work list
function sync_from_cloud_single_bucket(policy) {
    dbg.log2('Start sync_from_cloud_single_bucket on work list for policy', pretty_policy(policy));
    if (!policy) {
        throw new Error('bucket_work_list and bucket_work_list must be provided');
    }
    let bucket_work_lists = policy.work_lists;
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
                dbg.log2('sync_from_cloud_single_bucket syncing',
                    bucket_work_lists.c2n_deleted.length,
                    'deletions c2n with params',
                    util.inspect(params, {
                        depth: null
                    })
                );
                return P.ninvoke(policy.s3rver, 'deleteObjects', params);
            } else {
                dbg.log2('sync_to_cloud_single_bucket syncing deletions c2n, nothing to sync');
                return;
            }
        })
        .then(() => P.map(bucket_work_lists.c2n_deleted, obj => mark_cloud_synced_deleted(obj)))
        .catch(function(err) {
            dbg.error('sync_from_cloud_single_bucket failed on syncing deletions', err, err.stack);
            policy.health = false;
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
        .catch(function(error) {
            dbg.error('sync_from_cloud_single_bucket Failed syncing added objects c2n', error, error.stack);
            policy.health = false;
        })
        .then(function() {
            //TODO:: pop per file
            while (bucket_work_lists.c2n_added.length > 0) {
                bucket_work_lists.c2n_added.pop();
            }
            dbg.log1('Done sync_from_cloud_single_bucket on {', policy.bucket.name, policy.system._id, policy.endpoint, '}');
        })
        .return();
}

function update_bucket_last_sync(bucket, date) {
    return system_store.make_changes({
        update: {
            buckets: [{
                '_id': bucket._id,
                'cloud_sync.last_sync': date
            }]
        }
    });
}


// EXPORTS
exports.background_worker = background_worker;
exports.get_policy_status = get_policy_status;
exports.refresh_policy = refresh_policy;

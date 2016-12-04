'use strict';

var api = require('../../api');
var rpc = api.new_rpc();
var util = require('util');
var _ = require('lodash');
var AWS = require('aws-sdk');
var argv = require('minimist')(process.argv);
var P = require('../../util/promise');
var basic_server_ops = require('./basic_server_ops');
var dotenv = require('dotenv');
dotenv.load();
var promise_utils = require('../../util/promise_utils');
var test_utils = require('./test_utils');

const s3 = new AWS.S3({
    // endpoint: 'https://s3.amazonaws.com',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    s3ForcePathStyle: true,
    sslEnabled: false,
    signatureVersion: 'v4',
    // region: 'eu-central-1'
});

let TEST_CTX = {
    source_ip: '127.0.0.1',
    source_bucket: 'files',
    target_port: process.env.PORT || '5001',
    target_bucket: 'cloud-resource-jenkins-test',
    connection_name: 'unicorn',
    cloud_pool_name: 'majesticsloth'
};

var file_sizes = [1];
var file_names = ['нуба_1', 'нуба_2', 'нуба_3'];

var client = rpc.new_client({
    address: 'ws://' + TEST_CTX.source_ip + ':' + TEST_CTX.target_port
});


function init_s3() {
    return P.ninvoke(s3, 'headBucket', {
            Bucket: TEST_CTX.target_bucket
        })
        .then(() => list_all_s3_objects(TEST_CTX.target_bucket))
        .then(function(objects_to_delete) {
            if (_.isEmpty(objects_to_delete)) {
                console.log('init_s3:: There are no objects to delete');
                return;
            }

            let object_keys = _.map(objects_to_delete, obj => ({
                Key: obj.Key
            }));

            return P.ninvoke(s3, 'deleteObjects', {
                Bucket: TEST_CTX.target_bucket,
                Delete: { /* required */
                    Objects: object_keys
                }
            });
        })
        .catch(err => {
            // Only allow the bucket to not exist and continue the test by making it
            // Every other case is a problem for the test and will terminate it
            if (err && err.code === 'NotFound') {
                return P.ninvoke(s3, 'createBucket', {
                    Bucket: TEST_CTX.target_bucket
                });
            }

            console.error('init_s3::', err);
            throw err;
        });
}


function list_all_s3_objects(bucket_name) {
    // Initialization of IsTruncated in order to perform the first while cycle
    var listObjectsResponse = {
        is_truncated: true,
        objects: [],
        common_prefixes: [],
        key_marker: ''
    };

    return promise_utils.pwhile(
            function() {
                return listObjectsResponse.is_truncated;
            },
            function() {
                listObjectsResponse.is_truncated = false;
                return P.ninvoke(s3, 'listObjects', {
                        Bucket: bucket_name,
                        Marker: listObjectsResponse.key_marker
                    })
                    .then(function(res) {
                        listObjectsResponse.is_truncated = res.is_truncated;
                        let res_list = {
                            objects: res.Contents,
                            common_prefixes: res.common_prefixes
                        };
                        if (res_list.objects.length) {
                            listObjectsResponse.objects = _.concat(listObjectsResponse.objects, res_list.objects);
                        }
                        let last_obj = _.last(listObjectsResponse.objects);
                        listObjectsResponse.key_marker = last_obj && last_obj.key;
                    })
                    .catch(function(err) {
                        console.error(err);
                        throw err;
                    });
            })
        .then(() => {
            console.log('list_all_s3_objects - current cloud objects:', listObjectsResponse.objects);
            return listObjectsResponse.objects;
        });
}


function put_object(s3_obj, bucket, key) {
    return P.fcall(function() {
        return s3_obj.putObject({
            Bucket: bucket,
            Key: key
        }, function(err, data) {
            if (err) {
                console.warn('Failed with', err, err.stack);
                throw new Error(err);
            } else {
                return data;
            }
        });
    });
}





function authenticate() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return P.fcall(function() {
        return client.create_auth_token(auth_params);
    });
}


function verify_object_parts_on_cloud_nodes(replicas_in_tier, bucket_name, object_key, cloud_nodes) {
    // TODO: Currently set high because there is a problem with cloud resource test block write
    // That blocks the whole replication process
    let abort_timeout_sec = 10 * 60;
    let first_iteration = true;
    let blocks_correct = false;
    let start_ts;
    let blocks_to_return;

    return promise_utils.pwhile(
            function() {
                return !blocks_correct;
            },
            function() {
                blocks_correct = true;
                return client.object.read_object_mappings({
                        bucket: bucket_name,
                        key: object_key,
                        adminfo: true
                    })
                    .then(function(obj_mapping_arg) {
                        let blocks_by_cloud_pool_name = {};
                        _.forEach(cloud_nodes, node => {
                            blocks_by_cloud_pool_name[node] = {
                                blocks: []
                            };
                        });
                        _.forEach(obj_mapping_arg.parts, part => {
                            if (replicas_in_tier + ((cloud_nodes && cloud_nodes.length) || 0) !==
                                part.chunk.frags[0].blocks.length) {
                                blocks_correct = false;
                            }
                            _.forEach(part.chunk.frags[0].blocks, block => {
                                if (_.find(cloud_nodes, node => String(node) === String(block.adminfo.node_name))) {
                                    blocks_by_cloud_pool_name[block.adminfo.node_name].blocks.push(block);
                                }
                            });
                        });

                        _.forEach(blocks_by_cloud_pool_name, node => {
                            if (node.blocks.length !== obj_mapping_arg.parts.length) {
                                blocks_correct = false;
                            }
                        });

                        if (blocks_correct) {
                            console.log('verify_object_parts_on_cloud_nodes blocks found:', util.inspect(blocks_by_cloud_pool_name, {
                                depth: null
                            }));
                            blocks_to_return = blocks_by_cloud_pool_name;
                        } else {
                            if (first_iteration) {
                                start_ts = Date.now();
                                first_iteration = false;
                            }

                            let diff = Date.now() - start_ts;
                            if (diff > abort_timeout_sec * 1000) {
                                throw new Error('aborted verify_object_parts_on_cloud_nodes after ' + abort_timeout_sec + ' seconds');
                            }
                            return P.delay(500);
                        }
                    });
            })
        .then(() => blocks_to_return);
}


function main() {
    let replicas_in_tier;
    let files_bucket_tier;
    return authenticate()
        .then(function() {
            return init_s3();
        })
        .then(() => client.account.add_external_conenction({
            name: TEST_CTX.connection_name,
            endpoint: 'https://s3.amazonaws.com',
            identity: process.env.AWS_ACCESS_KEY_ID,
            secret: process.env.AWS_SECRET_ACCESS_KEY
        }))
        .then(() => client.pool.create_cloud_pool({
            name: TEST_CTX.cloud_pool_name,
            connection: TEST_CTX.connection_name,
            target_bucket: TEST_CTX.target_bucket
        }))
        .then(() => client.bucket.read_bucket({
            name: TEST_CTX.source_bucket
        }))
        .then(function(source_bucket) {
            let tier_name = source_bucket.tiering.tiers[0].tier;
            return client.tier.read_tier({
                    name: tier_name
                })
                .then(function(tier) {
                    replicas_in_tier = tier.replicas;
                    files_bucket_tier = tier;
                    let new_pools = [TEST_CTX.cloud_pool_name];
                    return client.tier.update_tier({
                        name: tier.name,
                        cloud_pools: new_pools
                    });
                });
        })
        // This is used in order to test removal of blocks that are relevant to the bucket assosiated
        .then(() => put_object(s3, TEST_CTX.target_bucket,
            `noobaa_blocks/noobaa-internal-agent-${TEST_CTX.cloud_pool_name}/blocks_tree/j3n14.blocks/m4g1c4l5l0th`))
        .then(function() {
            return P.each(file_names, function(fname) {
                return basic_server_ops.generate_random_file(file_sizes[0])
                    .then(function(fl) {
                        return basic_server_ops.upload_file(TEST_CTX.source_ip, fl, TEST_CTX.source_bucket, fname);
                    });
            });
        })
        // TODO Do the Azure node as well
        .then(() => verify_object_parts_on_cloud_nodes(replicas_in_tier, TEST_CTX.source_bucket,
            file_names[0], ['noobaa-internal-agent-' + TEST_CTX.cloud_pool_name]))
        .then(function(block_ids) {
            return test_utils.blocks_exist_on_cloud(true, TEST_CTX.cloud_pool_name, TEST_CTX.target_bucket,
                    _.map(block_ids['noobaa-internal-agent-' + TEST_CTX.cloud_pool_name].blocks, block => block.block_md.id), s3)
                .then(() => block_ids);
        })
        .then(function(block_ids) {
            return P.ninvoke(new AWS.S3({
                    endpoint: 'http://' + TEST_CTX.source_ip,
                    credentials: {
                        accessKeyId: argv.access_key || '123',
                        secretAccessKey: argv.secret_key || 'abc'
                    },
                    s3ForcePathStyle: true,
                    sslEnabled: false,
                    signatureVersion: 'v4',
                    // region: 'eu-central-1'
                }), 'deleteObject', {
                    Bucket: TEST_CTX.source_bucket,
                    Key: file_names[0]
                })
                // This is used in order to make sure that the blocks will be deleted from the cloud
                .then(() => test_utils.blocks_exist_on_cloud(false, TEST_CTX.cloud_pool_name, TEST_CTX.target_bucket,
                    _.map(block_ids['noobaa-internal-agent-' + TEST_CTX.cloud_pool_name].blocks, block => block.block_md.id), s3))
                .catch(err => {
                    console.error(err);
                    throw new Error('deleteObject::Blocks still on cloud');
                });
        })
        .then(() => verify_object_parts_on_cloud_nodes(replicas_in_tier, TEST_CTX.source_bucket,
            file_names[1], ['noobaa-internal-agent-' + TEST_CTX.cloud_pool_name]))
        .then((block_ids) => {
            return verify_object_parts_on_cloud_nodes(replicas_in_tier, TEST_CTX.source_bucket,
                    file_names[2], ['noobaa-internal-agent-' + TEST_CTX.cloud_pool_name])
                .then(function(second_block_ids) {
                    return {
                        first_blocks: block_ids,
                        second_blocks: second_block_ids
                    };
                });
        })
        .then(function(block_ids) {
            return test_utils.blocks_exist_on_cloud(true, TEST_CTX.cloud_pool_name, TEST_CTX.target_bucket,
                    _.map(block_ids.first_blocks['noobaa-internal-agent-' + TEST_CTX.cloud_pool_name].blocks, block => block.block_md.id), s3)
                .then(() => block_ids);
        })
        .then(function(block_ids) {
            // This is used in order to make sure that the blocks will be deleted from the cloud
            return client.tier.update_tier({
                    name: files_bucket_tier.name,
                    cloud_pools: []
                })
                .then(() => test_utils.blocks_exist_on_cloud(false, TEST_CTX.cloud_pool_name, TEST_CTX.target_bucket,
                    _.map(block_ids.first_blocks['noobaa-internal-agent-' + TEST_CTX.cloud_pool_name].blocks, block => block.block_md.id), s3))
                .then(() => test_utils.blocks_exist_on_cloud(false, TEST_CTX.cloud_pool_name, TEST_CTX.target_bucket,
                    _.map(block_ids.second_blocks['noobaa-internal-agent-' + TEST_CTX.cloud_pool_name].blocks, block => block.block_md.id), s3))
                .catch(err => {
                    console.error(err);
                    throw new Error('Remove Cloud Resource Policy::Blocks still on cloud');
                })
                .then(() => P.ninvoke(s3, 'headObject', {
                    Bucket: TEST_CTX.target_bucket,
                    Key: `noobaa_blocks/noobaa-internal-agent-${TEST_CTX.cloud_pool_name}/blocks_tree/j3n14.blocks/m4g1c4l5l0th`
                }));
        })
        .then(() => {
            console.log('test_cloud_pools PASSED');
            process.exit(0);
        })
        .catch(function(err) {
            console.error('test_cloud_pools FAILED', err);
            process.exit(1);
        })
        .done();
}

if (require.main === module) {
    main();
}

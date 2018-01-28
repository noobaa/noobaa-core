/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');
var promise_utils = require('../../util/promise_utils');
var _ = require('lodash');

function blocks_exist_on_cloud(need_to_exist, pool_id, bucket_name, blocks, s3) {
    console.log('blocks_exist_on_cloud::', need_to_exist, pool_id, bucket_name);
    var isDone = true;
    // Time in seconds to wait, notice that it will only check once a second.
    // This is done in order to lower the amount of checking requests.
    var MAX_RETRIES = 10 * 60;
    var wait_counter = 1;

    return promise_utils.pwhile(
            function() {
                return isDone;
            },
            function() {
                return P.all(_.map(blocks, function(block) {
                        console.log(`noobaa_blocks/${pool_id}/blocks_tree/${block.slice(block.length - 3)}.blocks/${block}`);
                        return P.ninvoke(s3, 'headObject', {
                            Bucket: bucket_name,
                            Key: `noobaa_blocks/${pool_id}/blocks_tree/${block.slice(block.length - 3)}.blocks/${block}`
                        }).reflect();
                    }))
                    .then(function(response) {
                        let condition_correct;
                        if (need_to_exist) {
                            condition_correct = true;
                            _.forEach(response, promise_result => {
                                if (promise_result.isRejected()) {
                                    condition_correct = false;
                                }
                            });

                            if (condition_correct) {
                                isDone = false;
                            } else {
                                wait_counter += 1;
                                if (wait_counter >= MAX_RETRIES) {
                                    throw new Error('Blocks do not exist');
                                }
                                return P.delay(1000);
                            }
                        } else {
                            condition_correct = true;
                            _.forEach(response, promise_result => {
                                if (promise_result.isFulfilled()) {
                                    condition_correct = false;
                                }
                            });

                            if (condition_correct) {
                                isDone = false;
                            } else {
                                wait_counter += 1;
                                if (wait_counter >= MAX_RETRIES) {
                                    throw new Error('Blocks still exist');
                                }
                                return P.delay(1000);
                            }
                        }
                    });
            })
        .then(function() {
            return true;
        })
        .catch(function(err) {
            console.error('blocks_exist_on_cloud::Final Error', err);
            throw err;
        });
}

exports.blocks_exist_on_cloud = blocks_exist_on_cloud;

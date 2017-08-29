/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
/* global setVerboseShell */
'use strict';

// This NooBaa epoch is used as initialization date value for md_aggregator
const NOOBAA_EPOCH = 1430006400000;

mongo_upgrade_17();

/* Upade mongo structures and values with new things since the latest version*/
function mongo_upgrade_17() {
    print('\nMONGO UPGRADE 17 - START ...');
    setVerboseShell(true);
    upgrade_buckets();
    upgrade_accounts();
    upgrade_pools();
    upgrade_nodes();
    upgrade_blocks();
    upgrade_tiering_policies();
    print('\nMONGO UPGRADE 17 - DONE.');
}

function upgrade_buckets() {
    initialize_buckets_storage_values();
}

function upgrade_blocks() {
    update_pools_of_blocks();
}

function upgrade_accounts() {
    update_allowed_buckets_and_has_login();
}

function upgrade_tiering_policies() {
    fix_spillover_structure();
}

function upgrade_pools() {
    initialize_pools_storage_values();
    introduce_resource_and_pool_node_type();
}

function upgrade_nodes() {
    introduce_node_type();
}

function update_allowed_buckets_and_has_login() {
    const owner_account = db.systems.find().toArray()[0].owner;
    db.accounts.find({
            has_login: {
                $exists: false
            }
        })
        .forEach(function(account) {
            var set_update = {};
            if (account.allowed_buckets) {
                var allowed_buckets = {
                    full_permission: false,
                    permission_list: account.allowed_buckets
                };

                if (account._id === owner_account) {
                    allowed_buckets = {
                        full_permission: true
                    };
                }

                set_update.allowed_buckets = allowed_buckets;
            }

            set_update.has_login = true;

            db.accounts.update({
                _id: account._id
            }, {
                $set: set_update
            });
        });
}

function introduce_resource_and_pool_node_type() {
    db.pools.find({
            resource_type: {
                $exists: false
            }
        })
        .forEach(function(pool) {
            let resource_type = 'HOSTS';
            let pool_node_type = 'BLOCK_STORE_FS';
            if (pool.mongo_pool_info) {
                pool_node_type = 'BLOCK_STORE_MONGO';
                resource_type = 'INTERNAL';
            } else if (pool.cloud_pool_info) {
                if (pool.cloud_pool_info.endpoint === 'AWS' ||
                    pool.cloud_pool_info.endpoint === 'S3_COMPATIBLE') {
                    pool_node_type = 'BLOCK_STORE_S3';
                } else {
                    pool_node_type = 'BLOCK_STORE_AZURE';
                }
                resource_type = 'CLOUD';
            }
            db.pools.update({
                _id: pool._id
            }, {
                $set: {
                    resource_type: resource_type,
                    pool_node_type: pool_node_type
                }
            });
        });
}

function introduce_node_type() {
    db.nodes.find({
            node_type: {
                $exists: false
            }
        })
        .forEach(function(node) {
            let node_type = 'BLOCK_STORE_FS';
            if (node.is_mongo_node) {
                node_type = 'BLOCK_STORE_MONGO';
            } else if (node.is_cloud_node) {
                var node_pool = db.pools.findOne({ _id: node.pool });
                if (node_pool) {
                    if (node_pool.cloud_pool_info.endpoint === 'AWS' ||
                        node_pool.cloud_pool_info.endpoint === 'S3_COMPATIBLE') {
                        node_type = 'BLOCK_STORE_S3';
                    } else {
                        node_type = 'BLOCK_STORE_AZURE';
                    }
                }
            } else if (node.s3_agent) {
                node_type = 'ENDPOINT_S3';
            }
            db.nodes.update({
                _id: node._id
            }, {
                $set: {
                    node_type: node_type
                }
            });
        });
}

function fix_spillover_structure() {
    db.tieringpolicies.find()
        .forEach(function(policy) {
            db.tieringpolicies.update({
                _id: policy._id
            }, {
                $set: {
                    tiers: policy.tiers.map(function(tier_and_order) {
                        return {
                            tier: tier_and_order.tier,
                            order: tier_and_order.order,
                            spillover: tier_and_order.is_spillover || false,
                            disabled: false
                        };
                    })
                }
            });
        });
}

function initialize_buckets_storage_values() {
    db.buckets.updateMany({
        'storage_stats.pools': {
            $exists: false
        }
    }, {
        $set: {
            storage_stats: {
                chunks_capacity: 0,
                blocks_size: 0,
                objects_size: 0,
                pools: {},
                objects_count: 0,
                objects_hist: [],
                last_update: NOOBAA_EPOCH
            }
        }
    });
}

function initialize_pools_storage_values() {
    db.pools.updateMany({
        'storage_stats.blocks_size': {
            $exists: false
        }
    }, {
        $set: {
            storage_stats: {
                blocks_size: 0,
                last_update: NOOBAA_EPOCH
            }
        }
    });
}

function update_pools_of_blocks() {
    // Just a simple check if we need to scan all of the blocks or not
    const block = db.datablocks.findOne();
    if (!block || block.pool) return;
    db.nodes.find()
        .toArray()
        .forEach(node => {
            db.datablocks.updateMany({
                node: node._id
            }, {
                $set: {
                    pool: node.pool
                }
            });
        });
}

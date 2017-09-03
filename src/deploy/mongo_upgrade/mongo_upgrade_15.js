/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
/* global setVerboseShell*/
'use strict';

// the following params are set from outside the script
// using mongo --eval 'var param_ip="..."' and we only declare them here for completeness
var param_bcrypt_secret;
var param_client_subject;

// This NooBaa epoch is used as initialization date value for md_aggregator
const NOOBAA_EPOCH = 1430006400000;

mongo_upgrade_15();

/* Upade mongo structures and values with new things since the latest version*/
function mongo_upgrade_15() {
    print('\nMONGO UPGRADE 15 - START ...');
    setVerboseShell(true);
    add_ssl_user();
    upgrade_systems();
    remove_unnamed_nodes();
    fix_nodes_pool_to_object_id();
    upgrade_cloud_agents();
    upgrade_tier_pools();
    upgrade_accounts();
    update_default_pool();
    upgrade_pools();
    upgrade_buckets();
    upgrade_usage_stats();
    blocks_to_buckets_upgrade();
    upgrade_object_mds_total_parts();
    upgrade_server_hb();
    print('\nMONGO UPGRADE 15 - DONE.');
}

function add_ssl_user() {
    var user = db.getSiblingDB("$external").getUser(param_client_subject);
    if (user) {
        print('\nDB already contains a user for subject', param_client_subject);
    } else {
        print('\nAdding a DB user for subject', param_client_subject);
        db.getSiblingDB("$external").runCommand({
            createUser: param_client_subject,
            roles: [{
                role: "root",
                db: 'admin'
            }]
        });
    }
}

function upgrade_systems() {
    db.systems.find().forEach(upgrade_system);
}


function upgrade_system(system) {
    print('\n*** upgrade_system ...', system.name);

    var support_account_found = false;
    db.accounts.find().forEach(function(account) {
        if (account.is_support) {
            if (support_account_found) {
                print('\n*** more than one support account exists! deleting');
                db.accounts.deleteMany({
                    _id: account._id
                });
            } else {
                support_account_found = true;
                if (String(account.password) !== String(param_bcrypt_secret)) {
                    print('\n*** updated old support account', param_bcrypt_secret);
                    db.accounts.update({
                        _id: account._id
                    }, {
                        $set: {
                            password: param_bcrypt_secret
                        },
                        $unset: {
                            __v: 1
                        }
                    });
                }
            }
        } else {
            db.accounts.update({
                _id: account._id
            }, {
                $unset: {
                    __v: 1
                }

            });
        }
    });
}

function upgrade_cloud_agents() {
    print('\n*** upgrade_cloud_agents ...');

    // go over cloud pools and copy
    db.pools.find({
        "deleted": {
            $exists: false
        },
        "cloud_pool_info": {
            $exists: true
        }
    }).forEach(function(pool) {
        var path = '/root/node_modules/noobaa-core/agent_storage/noobaa-internal-agent-' + pool.name + '/token';
        var token;
        try {
            print('upgrading cloud_pool ' + pool.name);
            if (!pool.cloud_pool_info.agent_info) {
                print('adding agent info to ' + pool.name);
                token = cat(path);
                db.pools.update({
                    _id: pool._id
                }, {
                    $set: {
                        "cloud_pool_info.agent_info": {
                            node_token: token,
                            cloud_path: "noobaa_blocks/noobaa-internal-agent-" + pool.name
                        }
                    }
                });
            } else if (!pool.cloud_pool_info.agent_info.cloud_path) {
                print('adding cloud path to agent info in ' + pool.name + ' cloud_path = noobaa_blocks/noobaa-internal-agent-' + pool.name);
                db.pools.update({
                    _id: pool._id
                }, {
                    $set: {
                        "cloud_pool_info.agent_info.cloud_path": "noobaa_blocks/noobaa-internal-agent-" + pool.name
                    }
                });
            }
        } catch (err) {
            print('encountered error when upgrading cloud pool ' + pool.name + ' ', err);
        }
    });

    // update cloud node names with pool id instead of pool name
    var cloud_nodes = db.nodes.find({
        is_cloud_node: true
    }).toArray();
    cloud_nodes.forEach(function(node) {
        var new_name = 'noobaa-internal-agent-' + node.pool;
        print('renaming cloud node ' + node.name + ' to ' + new_name);
        db.nodes.update({ _id: node._id }, {
            $set: {
                name: new_name
            }
        });
    });

}

function upgrade_object_mds_total_parts() {
    db.objectmds.find({
        num_parts: {
            $exists: false
        },
        deleted: {
            $exists: false
        }
    }).forEach(function(obj) {
        db.objectmds.update({
            _id: obj._id
        }, {
            $set: {
                num_parts: db.objectparts.count({
                    obj: obj._id
                })
            }
        });
    });
}

function upgrade_tier_pools() {
    print('\n*** upgrade_tier_pools ...');
    db.tiers.find({
        pools: {
            $exists: true
        }
    }).forEach(function(tier) {
        var mirrors = [];
        if (tier.data_placement === 'MIRROR') {
            tier.pools.forEach(function(pool_object_id) {
                mirrors.push({
                    spread_pools: [pool_object_id]
                });
            });
        } else {
            mirrors.push({
                spread_pools: tier.pools
            });
        }

        db.tiers.update({
            _id: tier._id
        }, {
            $set: {
                mirrors: mirrors
            },
            $unset: {
                pools: 1
            }
        });
    });
}

function remove_unnamed_nodes() {
    var nodes_ids_to_delete = [];
    db.nodes.find({
            name: /^a-node-has-no-name-/
        })
        .forEach(function(node) {
            print('remove_unnamed_nodes: Checking blocks for',
                node.name, node._id, 'system', node.system);
            var num_blocks = db.datablocks.count({
                system: node.system,
                node: node._id,
                deleted: null
            });
            if (num_blocks > 0) {
                print('remove_unnamed_nodes: Found', num_blocks, 'blocks (!!!)',
                    node.name, node._id, 'system', node.system);
            } else {
                print('remove_unnamed_nodes: Deleting node',
                    node.name, node._id, 'system', node.system);
                nodes_ids_to_delete.push(node._id);
            }
        });
    if (nodes_ids_to_delete.length) {
        db.nodes.deleteMany({
            _id: {
                $in: nodes_ids_to_delete
            }
        });
    }
}

function upgrade_accounts() {
    add_defaults_to_sync_credentials_cache();
    remove_unlinked_buckets_from_premissions();
}

function remove_unlinked_buckets_from_premissions() {
    print('\n*** remove_unlinked_buckets_from_premissions ...');
    const existing_buckets = db.buckets.find({
            deleted: null
        }, {
            _id: 1
        }).toArray()
        .map(function(item) {
            return String(item._id);
        });

    db.accounts.find({
        deleted: null
    }, {
        _id: 1,
        allowed_buckets: 1
    }).forEach(function(account) {
        if (account.allowed_buckets && account.allowed_buckets.length) {
            const remove_buckets = account.allowed_buckets.filter(function(item) {
                if (existing_buckets.indexOf(String(item)) > -1) {
                    return false;
                }
                return true;
            });

            if (remove_buckets.length) {
                db.accounts.update({
                    _id: account._id
                }, {
                    $pull: {
                        allowed_buckets: {
                            $in: remove_buckets
                        }
                    }
                });
            }
        }
    });
}

function add_defaults_to_sync_credentials_cache() {
    print('\n*** add_defaults_to_sync_credentials_cache ...');
    db.accounts.find().forEach(function(account) {
        var credentials = account.sync_credentials_cache;
        if (credentials) {
            var new_credentials = [];
            credentials.forEach(function(connection) {
                var new_connection = connection;
                new_connection.name = connection.name || connection.access_key;
                new_connection.endpoint = connection.endpoint || 'https://s3.amazonaws.com';
                new_credentials.push(new_connection);
            });
            db.accounts.update({
                _id: account._id
            }, {
                $set: {
                    sync_credentials_cache: new_credentials
                }
            });
        }
    });
}

function update_default_pool() {
    print('\n*** update_default_pool ...');
    var default_pool = db.pools.findOne({ name: "default_pool" });
    if (default_pool) {
        db.accounts.find().forEach(function(account) {
            if (!account.default_pool) {
                db.accounts.update({
                    _id: account._id
                }, {
                    $set: {
                        default_pool: default_pool._id
                    }
                });
            }
        });
    }
}

function upgrade_pools() {
    add_account_id_to_cloud_pools();
}

function upgrade_buckets() {
    add_account_id_to_cloud_sync();
    initialize_storage_values();
}

function initialize_storage_values() {
    db.buckets.updateMany({
        'storage_stats.blocks_size': {
            $exists: false
        }
    }, {
        $set: {
            storage_stats: {
                chunks_capacity: 0,
                blocks_size: 0,
                objects_size: 0,
                objects_count: 0,
                objects_hist: [],
                last_update: NOOBAA_EPOCH
            }
        }
    });
}

function upgrade_usage_stats() {
    db.objectstats.deleteMany({});
}

function add_account_id_to_cloud_pools() {
    print('\n*** add_account_id_to_cloud_pools ...');
    db.pools.find({
        cloud_pool_info: {
            $exists: true
        }
    }).forEach(function(pool) {
        var cloud_pool_info_to_set = add_credentials_to_missing_account_id(pool.cloud_pool_info);
        if (cloud_pool_info_to_set) {
            db.pools.update({
                _id: pool._id
            }, {
                $set: {
                    cloud_pool_info: cloud_pool_info_to_set
                }
            });
        }
    });
}

function add_account_id_to_cloud_sync() {
    print('\n*** add_account_id_to_cloud_sync ...');
    db.buckets.find({
        cloud_sync: {
            $exists: true
        }
    }).forEach(function(bucket) {
        var cloud_sync_info_to_set = add_credentials_to_missing_account_id(bucket.cloud_sync);
        if (cloud_sync_info_to_set) {
            db.buckets.update({
                _id: bucket._id
            }, {
                $set: {
                    cloud_sync: cloud_sync_info_to_set
                }
            });
        }
    });
}

function add_credentials_to_missing_account_id(credentials) {
    print('\n*** add_credentials_to_missing_account_id ...');
    if (credentials &&
        credentials.access_keys &&
        credentials.access_keys.access_key &&
        !credentials.access_keys.account_id) {
        credentials.access_keys.account_id = find_account_id_by_credentials(credentials.access_keys.access_key);
        return credentials;
    }
}

function find_account_id_by_credentials(access_key) {
    var ret = "";
    db.accounts.find({
        sync_credentials_cache: {
            $exists: true
        },
        deleted: {
            $exists: false
        },
    }).forEach(function(account) {
        var candidate_credentials = account.sync_credentials_cache;
        candidate_credentials.forEach(function(connection) {
            if (connection.access_key === access_key) {
                ret = account._id;
            }
        });
    });
    return ret;
}

function fix_nodes_pool_to_object_id() {
    print('\n*** fix_nodes_pool_to_object_id ...');
    // Type 2 is String ref: https://docs.mongodb.com/v3.0/reference/operator/query/type/
    db.nodes.find({
        pool: {
            $type: 2
        }
    }).forEach(function(node) {
        db.nodes.update({
            _id: node._id
        }, {
            $set: {
                pool: new ObjectId(node.pool)
            }
        });
    });
}


function blocks_to_buckets_upgrade() {
    const CHUNKS_PER_CYCLE = 1000;
    const SYSTEM_MONGO_STATE = db.systems.findOne({}, {
        mongo_upgrade: 1
    });

    if (SYSTEM_MONGO_STATE &&
        SYSTEM_MONGO_STATE.mongo_upgrade &&
        SYSTEM_MONGO_STATE.mongo_upgrade.blocks_to_buckets) return;

    var chunk_id_marker = update_blocks_of_chunks(
        db.datachunks.find({}, {
            _id: 1,
            bucket: 1
        }, {
            sort: {
                _id: 1
            },
            limit: CHUNKS_PER_CYCLE
        }).toArray()
    );

    while (chunk_id_marker) {
        chunk_id_marker = update_blocks_of_chunks(
            db.datachunks.find({
                _id: {
                    $gt: chunk_id_marker
                }
            }, {
                _id: 1,
                bucket: 1
            }, {
                sort: {
                    _id: 1
                },
                limit: CHUNKS_PER_CYCLE
            }).toArray()
        );
    }

    db.systems.update({}, {
        $set: {
            "mongo_upgrade.blocks_to_buckets": true
        }
    });
}

function update_blocks_of_chunks(chunks) {
    var chunks_by_bucket = {};
    chunks.forEach(chunk => {
        chunks_by_bucket[chunk.bucket.valueOf()] = chunks_by_bucket[chunk.bucket.valueOf()] || [];
        chunks_by_bucket[chunk.bucket.valueOf()].push(chunk._id);
    });

    Object.keys(chunks_by_bucket).forEach(bucket_id => {
        db.datablocks.updateMany({
            chunk: {
                $in: chunks_by_bucket[bucket_id]
            }
        }, {
            $set: {
                bucket: new ObjectId(bucket_id)
            }
        });
    });

    return chunks.length ? chunks[chunks.length - 1]._id : null;
}

function upgrade_server_hb() {
    print('\n*** fix_nodes_pool_to_object_id ...');
    db.clusters.updateMany({}, {
        $unset: {
            services_status: 1,
            __v: 1
        }
    });
}

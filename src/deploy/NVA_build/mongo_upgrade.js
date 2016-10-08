/* eslint-env mongo */
/* global setVerboseShell */
/* global sleep */

'use strict';
// the following params are set from outside the script
// using mongo --eval 'var param_ip="..."' and we only declare them here for completeness
var param_ip;
var param_secret;
var param_bcrypt_secret;
setVerboseShell(true);
upgrade();

/* Upade mongo structures and values with new things since the latest version*/
function upgrade() {
    sync_cluster_upgrade();
    upgrade_systems();
    upgrade_cluster();
    upgrade_system_access_keys();
    upgrade_object_mds();
    remove_unnamed_nodes();
    // cluster upgrade: mark that upgrade is completed for this server
    mark_completed(); // do not remove
    print('\nUPGRADE DONE.');
}

function sync_cluster_upgrade() {
    // find if this server should perform mongo upgrade
    var is_mongo_upgrade = db.clusters.find({
        owner_secret: param_secret
    }).toArray()[0].upgrade.mongo_upgrade;

    // if this server shouldn't run mongo_upgrade, set status to DB_READY,
    // to indicate that this server is upgraded and with mongo running.
    // then wait for master to complete upgrade
    if (!is_mongo_upgrade) {
        db.clusters.update({
            owner_secret: param_secret
        }, {
            $set: {
                "upgrade.status": "DB_READY"
            }
        });
        var max_iterations = 100;
        var i = 0;
        while (i < max_iterations) {
            print('waiting for master to complete mongo upgrade...');
            i += 1;
            try {
                var master_status = db.clusters.find({
                    "upgrade.mongo_upgrade": true
                }).toArray()[0].upgrade.status;
                if (master_status === 'COMPLETED') {
                    print('\nmaster completed mongo_upgrade - finishing upgrade of this server');
                    mark_completed();
                    quit();
                }
            } catch (err) {
                print(err);
            }
            sleep(10000);
        }
        print('\nERROR: master did not finish mongo_upgrade in time!!! finishing upgrade of this server');
        quit();
    }
}

function mark_completed() {
    // mark upgrade status of this server as completed
    db.clusters.update({
        owner_secret: param_secret
    }, {
        $set: {
            "upgrade.status": "COMPLETED"
        }
    });
}

function upgrade_systems() {
    print('\n*** updating systems resources links ...');
    db.systems.find().forEach(function(system) {
        var updates = {};

        if (!system.resources.linux_agent_installer) {
            updates.resources = {
                linux_agent_installer: 'noobaa-setup',
                agent_installer: 'noobaa-setup.exe',
                s3rest_installer: 'noobaa-s3rest.exe'
            };
        }

        if (!system.n2n_config) {
            updates.n2n_config = {
                tcp_tls: true,
                tcp_active: true,
                tcp_permanent_passive: {
                    min: 60100,
                    max: 60600
                },
                udp_dtls: true,
                udp_port: true,
            };
        }

        if (!system.freemium_cap) {
            updates.freemium_cap = {
                phone_home_upgraded: false,
                phone_home_notified: false,
                cap_terabytes: 0 //Upgraded systems which didn't have the cap before are customers, don't cap
            };
        }

        var updated_access_keys = system.access_keys;
        if (updated_access_keys) {
            for (var i = 0; i < updated_access_keys.length; ++i) {
                if (updated_access_keys[i]._id) {
                    delete updated_access_keys[i]._id;
                }
            }
            updates.access_keys = updated_access_keys;
        }

        // optional fix - convert to idate format from ISO date
        if (typeof(system.last_stats_report) !== 'number') {
            updates.last_stats_report = new Date(system.last_stats_report).getTime() || 0;
        }
        if (typeof(system.maintenance_mode) !== 'number') {
            updates.maintenance_mode = new Date(system.maintenance_mode).getTime() || 0;
        }

        print('updating system', system.name, '...');
        printjson(updates);
        printjson(system);
        db.systems.update({
            _id: system._id
        }, {
            $set: updates,
            $unset: {
                __v: 1
            }
        });

    });
    db.systems.find().forEach(upgrade_system);
}


function upgrade_system(system) {
    print('\n*** upgrade_system ...', system.name);

    print('\n*** BUCKET STATS***');
    db.bucket.find({
        system: system._id,
    }).forEach(function(bucket) {
        var stats = {
            reads: 0,
            writes: 0,
        };
        if (bucket.stats) {
            stats.reads = bucket.stats.reads ? bucket.stats.reads : 0;
            stats.writes = bucket.stats.writes ? bucket.stats.writes : 0;
        }
        db.buckjets.update({
            _id: bucket._id
        }, {
            $set: {
                stats: stats
            }
        });
    });

    db.buckets.find({
        system: system._id,
        cloud_sync: {
            $exists: true
        }
    }).forEach(function(bucket) {
        print('\n*** CLOUD SYNC update bucket with endpoint and target bucket', bucket.name);
        if (bucket.cloud_sync.target_bucket) {
            print('\n*** nothing to upgrade for ', bucket.name);
        } else {
            var target_bucket = bucket.cloud_sync.endpoint;
            db.buckets.update({
                _id: bucket._id
            }, {
                $set: {
                    'cloud_sync.target_bucket': target_bucket,
                    'cloud_sync.endpoint': 'https://s3.amazonaws.com'
                }
            });
        }
    });
    db.buckets.find({
        system: system._id,
        __v: {
            $exists: true
        }
    }).forEach(function(bucket) {
        print('\n*** update bucket - remove __v', bucket.name);

        db.buckets.update({
            _id: bucket._id
        }, {
            $unset: {
                __v: 1
            }
        });
    });

    db.accounts.find().forEach(function(account) {

        if (account.sync_credentials_cache &&
            account.sync_credentials_cache.length > 0) {
            var updated_access_keys = account.sync_credentials_cache;
            //print('\n ** update accounts with credentials cache***',account);
            //printjson(account);
            for (var i = 0; i < updated_access_keys.length; ++i) {
                if (updated_access_keys[i]._id) {
                    delete updated_access_keys[i]._id;
                }
                if (!updated_access_keys[i].endpoint) {
                    print('\n*** update endpoint in sync_credentials_cache', updated_access_keys[i]);
                    updated_access_keys[i].endpoint = "https://s3.amazonaws.com";
                }
            }
            var updates = {};
            updates.sync_credentials_cache = updated_access_keys;
            printjson(updates);
            db.accounts.update({
                _id: account._id
            }, {
                $set: updates,
                $unset: {
                    __v: 1
                }

            });
        } else if (account.is_support && String(account.password) !== String(param_bcrypt_secret)) {
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

    print('\n*** OBJECT STATS ***');
    db.objectstats.update({
        s3_errors_info: {
            $exists: false
        }
    }, {
        $set: {
            // Notice that I've left an empty object, this is done on purpose
            // In order to distinguish what from old records and new records
            // The new records will have a minimum of total_errors property
            // Even if we did not encounter any s3 related errors
            s3_errors_info: {}
        }
    }, {
        multi: true
    });
}

function upgrade_system_access_keys() {
    print('\n*** upgrade_system_access_keys ...');

    db.systems.find().forEach(function(system) {
        var updates = {};
        if (system.access_keys) {
            updates.access_keys = [{
                access_key: system.access_keys[0].access_key,
                secret_key: system.access_keys[0].secret_key
            }];

            var allowed_buckets = [];
            db.buckets.find({
                deleted: null
            }).forEach(function(bucket) {
                allowed_buckets.push(bucket._id);
            });
            updates.allowed_buckets = allowed_buckets;

            var account_to_update = db.accounts.findOne({
                _id: system.owner
            });

            print('Updating Owner Account: ', account_to_update.email, '...');
            printjson(updates);
            printjson(account_to_update);

            db.accounts.update({
                _id: account_to_update._id
            }, {
                $set: updates,
                $unset: {
                    __v: 1
                }
            });

            db.roles.update({}, {
                $unset: {
                    __v: 1
                }
            });
            db.systems.update({
                _id: system._id
            }, {
                $unset: {
                    access_keys: 1,
                    __v: 1
                }
            });
        }
    });
}

function upgrade_cluster() {
    print('\n*** upgrade_cluster ...');

    var system = db.systems.findOne();
    var clusters = db.clusters.find();
    if (clusters.size()) {
        // if owner_shardname does not exist, set it to default
        if (!clusters[0].owner_shardname) {
            db.clusters.update({}, {
                $set: {
                    owner_shardname: 'shard1',
                    cluster_id: param_secret
                }
            });
        }
        print('\n*** Clusters up to date');
        return;
    }

    var cluster = {
        is_clusterized: false,
        owner_secret: param_secret,
        owner_address: param_ip,
        owner_shardname: 'shard1',
        location: 'Earth',
        cluster_id: param_secret,
        shards: [{
            shardname: 'shard1',
            servers: [{
                address: param_ip
            }]
        }],
        config_servers: [],
    };

    if (system.ntp) {
        cluster.ntp = system.ntp;
        db.systems.update({
            _id: system._id
        }, {
            $unset: {
                ntp: 1,
                __v: 1
            }
        });
    }

    //global param_secret:true, params_cluster_id:true, param_ip:true
    db.clusters.insert(cluster);
}

function upgrade_object_mds() {
    print('\n*** upgrade_object_mds ...');
    db.objectmds.find({
        upload_size: {
            $exists: true
        }
    }).forEach(function(obj) {
        db.objectmds.update({
            _id: obj._id
        }, {
            $set: {
                upload_started: obj.create_time
            },
            $unset: {
                create_time: 1
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

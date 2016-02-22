/* global db, print, printjson, ObjectId, setVerboseShell */
/* jshint -W089 */ // ignore for-in loops without hasOwnProperty checks
'use strict';
var DEFAULT_POOL_NAME = 'default_pool';
var DEFAULT_TIER_NAME = 'default_tier';
setVerboseShell(true);
upgrade();

/* Upade mongo structures and values with new things since the latest version*/
function upgrade() {
    upgrade_systems();
    upgrade_chunks_add_ref_to_bucket();
    print('\nUPGRADE DONE.');
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
        print('updating system', system.name, '...', updates);
        printjson(system);
        db.systems.update({
            _id: system._id
        }, {
            $set: updates
        });
    });
    db.systems.find().forEach(upgrade_system);
}


function upgrade_system(system) {
    print('\n*** upgrade_system ...', system.name);

    print('\n*** POOL ***');

    print('*** find', DEFAULT_POOL_NAME);
    var default_pool = db.pools.findOne({
        system: system._id,
        name: DEFAULT_POOL_NAME
    });
    if (default_pool) {
        print('*** found', DEFAULT_POOL_NAME, default_pool._id);
    } else {
        print('*** creating', DEFAULT_POOL_NAME, '...');
        db.pools.insert({
            system: system._id,
            name: DEFAULT_POOL_NAME
        });
        default_pool = db.pools.findOne({
            system: system._id,
            name: DEFAULT_POOL_NAME
        });
    }

    print('\n*** NODE ***');

    print('*** assign nodes to default pool ...');
    db.nodes.update({
        system: system._id,
        pool: null
    }, {
        $set: {
            pool: default_pool._id
        },
    }, {
        multi: true
    });

    print('*** remove old refs from nodes to tier ...');
    db.nodes.update({
        system: system._id,
        tier: {
            $exists: true
        }
    }, {
        $unset: {
            tier: 1
        }
    }, {
        multi: true
    });

    print('\n*** TIER ***');

    print('*** remove old tiers ...');
    db.tiers.remove({
        system: system._id,
        $or: [{
            pools: null
        }, {
            data_placement: null
        }, {
            replicas: null
        }, {
            data_fragments: null
        }, {
            parity_fragments: null
        }]
    }, {
        multi: true
    });

    print('*** find', DEFAULT_TIER_NAME);
    var default_tier = db.tiers.findOne({
        system: system._id,
        name: DEFAULT_TIER_NAME
    });
    if (default_tier) {
        print('*** already exists', DEFAULT_TIER_NAME, default_tier._id);
    } else {
        print('*** creating', DEFAULT_TIER_NAME, '...');
        db.tiers.insert({
            system: system._id,
            name: DEFAULT_TIER_NAME,
            data_placement: 'SPREAD',
            replicas: 3,
            data_fragments: 1,
            parity_fragments: 0,
            pools: [default_pool._id],
        });
        default_tier = db.tiers.findOne({
            system: system._id,
            name: DEFAULT_TIER_NAME
        });
    }

    print('\n*** BUCKET ***');

    print('\n*** find old buckets without tiering ...');
    db.buckets.find({
        system: system._id,
        tiering: null
    }).forEach(function(bucket) {
        var policy_name = bucket.name + '_tiering_' + Date.now();
        print('*** creating tiering policy', policy_name, '...');
        db.tieringpolicies.insert({
            system: system._id,
            name: policy_name,
            tiers: [{
                order: 0,
                tier: default_tier._id
            }]
        });
        var tiering_policy = db.tieringpolicies.findOne({
            system: system._id,
            name: policy_name
        });
        print('*** assign bucket to tiering policy',
            bucket._id, policy_name, '...');
        db.buckets.update({
            _id: bucket._id
        }, {
            $set: {
                tiering: tiering_policy._id
            }
        });
    });

}

function upgrade_chunks_add_ref_to_bucket() {
    print('\n*** upgrade_chunks_add_ref_to_bucket ...');

    var num_chunks_to_upgrade = db.datachunks.count({
        bucket: null
    });
    if (!num_chunks_to_upgrade) {
        print('\n*** no chunks require upgrade.');
        // return;
    }
    print('\n*** number of chunks to upgrade', num_chunks_to_upgrade);

    // find all the objects and map them to buckets
    // notice that the map keeps strings, and not object ids
    // in order to correctly match equal ids
    var num_objects = 0;
    var map_obj_to_bucket = {};
    db.objectmds.find({
        deleted: null
    }, {
        _id: 1,
        bucket: 1,
    }).forEach(function(obj) {
        num_objects += 1;
        map_obj_to_bucket[obj._id.valueOf()] = obj.bucket.valueOf();
    });

    // find all parts in order to map chunks to objects and therefore to buckets
    var num_parts = 0;
    var map_chunk_to_bucket = {};
    db.objectparts.find({
        deleted: null
    }, {
        _id: 1,
        obj: 1,
        chunk: 1
    }).forEach(function(part) {
        num_parts += 1;
        var obj_id = part.obj.valueOf();
        var chunk_id = part.chunk.valueOf();
        var obj_bucket = map_obj_to_bucket[obj_id] || '';
        var chunk_bucket = map_chunk_to_bucket[chunk_id] || '';
        if (chunk_bucket && obj_bucket !== chunk_bucket) {
            print('OHHH NO not sure which bucket to use for chunk',
                'obj_bucket', obj_bucket,
                'chunk_bucket', chunk_bucket,
                'part._id', part._id,
                'part.obj', part.obj,
                'part.chunk', part.chunk);
        } else {
            map_chunk_to_bucket[chunk_id] = obj_bucket;
        }
    });

    print('num_objects:', num_objects);
    print('num_parts:', num_parts);

    print('\nmap_obj_to_bucket:');
    printjson(map_obj_to_bucket);

    print('\nmap_chunk_to_bucket:');
    printjson(map_chunk_to_bucket);

    // invert the map of chunks to bucket to have a map of bucket to array of chunks
    // which allows to send single batch update command for all the chunks per bucket.
    var bucket;
    var chunk;
    var bucket_to_chunks = {};
    for (chunk in map_chunk_to_bucket) {
        bucket = map_chunk_to_bucket[chunk];
        bucket_to_chunks[bucket] = bucket_to_chunks[bucket] || [];
        // notice we have to convert the strings back to object id
        // so that when sending to the update query it will find the relevant chunks
        bucket_to_chunks[bucket].push(new ObjectId(chunk));
    }

    for (bucket in bucket_to_chunks) {
        var chunks = bucket_to_chunks[bucket];
        print('\nupdating bucket', bucket, 'for all these chunks:');
        printjson(chunks);
        db.datachunks.update({
            _id: {
                $in: chunks
            },
            bucket: null
        }, {
            $set: {
                bucket: bucket
            }
        }, {
            multi: true
        });
    }
}

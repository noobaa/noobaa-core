/* Copyright (C) 2016 NooBaa */
'use strict';

const mongodb = require('mongodb');

var global_id = 0;
const WRITE_SIZE = 4 * 1024 * 1024;
const COLL = 'gridfs_stress';
const CHUNKS_COLL = `${COLL}.chunks`;
const FILES_COLL = `${COLL}.files`;
const CHUNK_SIZE = undefined; // Default value is: 256 * 1024;
const GRID_FS_CHUNK_COLLECTION_OPTIONS = {
    storageEngine: {
        wiredTiger: {
            configString: "memory_page_max=512,os_cache_dirty_max=1,os_cache_max=1"
        }
    }
};

// gridfs_stress's whole purpose is to check capabilities and limits of GridFS
// we simulate a clean enviroment for GridFS with same configurations as on our md servers
// this is done in order to find benchmarks that we could compare with our server's implementation
function write_gridfs_file(bucket) {
    return new Promise((resolve, reject) => {

        const fname = `gridfs_stress_${Date.now()}_${global_id}`;
        global_id += 1;

        const data = Buffer.alloc(WRITE_SIZE, 'J');

        console.log('writing', fname, 'size', data.length);

        const stream = bucket.openUploadStream(fname);
        stream.once('error', reject)
            .once('finish', resolve)
            .end(data);
    });
}

async function write_gridfs_files(bucket) {
    for (let i = 0; i < 50; ++i) {
        await write_gridfs_file(bucket);
    }
}

async function gridfs_stress(db) {
    const bucket = new mongodb.GridFSBucket(db, {
        bucketName: COLL,
        chunkSizeBytes: CHUNK_SIZE,
    });
    await db.dropCollection(CHUNKS_COLL);
    await db.dropCollection(FILES_COLL);
    await db.createCollection(CHUNKS_COLL, GRID_FS_CHUNK_COLLECTION_OPTIONS);
    await db.createCollection(FILES_COLL);

    await Promise.all(
        new Array(35).fill(1).map(() => write_gridfs_files(bucket))
    );
}

async function main() {
    const db = await mongodb.MongoClient.connect('mongodb://localhost/test');
    await gridfs_stress(db);
    await db.close();
}

main();

/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

const md = {};
const total_num_objects = db.objectmds.count();
let total_storage_size = 0;
let total_index_size = 0;

function human_bytes(bytes) {
    if (bytes < 1024) return bytes + ' Bytes';
    bytes /= 1024;
    if (bytes < 1024) return bytes.toFixed(1) + ' KB';
    bytes /= 1024;
    if (bytes < 1024) return bytes.toFixed(1) + ' MB';
    bytes /= 1024;
    if (bytes < 1024) return bytes.toFixed(1) + ' GB';
    bytes /= 1024;
    if (bytes < 1024) return bytes.toFixed(1) + ' TB';
    bytes /= 1024;
    if (bytes < 1024) return bytes.toFixed(1) + ' PB';
}

function stat_collection(name) {
    const col = db[name];
    const stats = col.stats();
    const count_per_object = stats.count / total_num_objects;
    const storage_size = Math.ceil(stats.storageSize / stats.count);
    const index_size = Math.ceil(stats.totalIndexSize / stats.count);
    md[name] = { name, col, stats };
    total_storage_size += stats.storageSize;
    total_index_size += stats.totalIndexSize;
    print(`Collection ${name}:`);
    print(`  Count                : ${stats.count}`);
    print(`  Average per Object   : ${count_per_object.toFixed(2)}`);
    print(`  Average Storage Size : ${human_bytes(storage_size)}`);
    print(`  Average Index Size   : ${human_bytes(index_size)}`);
    print();
}

function scale_by_objects(title, num_objects) {
    const objects_ratio = num_objects / total_num_objects;
    print(title);
    print(`  Storage Size : ${human_bytes(total_storage_size * objects_ratio)}`);
    print(`  Index Size   : ${human_bytes(total_index_size * objects_ratio)}`);
    print();
}

print();

stat_collection('objectmds');
stat_collection('objectparts');
stat_collection('objectmultiparts');
stat_collection('datachunks');
stat_collection('datablocks');

scale_by_objects(`Current Scale ${total_num_objects} objects:`, total_num_objects);
scale_by_objects('Scale Estimate 1 M objects:', 1000000);
scale_by_objects('Scale Estimate 10 M objects:', 10000000);
scale_by_objects('Scale Estimate 100 M objects:', 100000000);
scale_by_objects('Scale Estimate 1000 M objects:', 1000000000);

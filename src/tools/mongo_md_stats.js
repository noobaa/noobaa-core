/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

const num_objects = db.objectmds.stats().count;
let disk_size_per_obj = 0;
let index_size_per_obj = 0;

function stat_col(name) {
    const col = db[name];
    const s = col.stats();
    const num_per_object = s.count / num_objects;
    const disk_size = Math.ceil(s.storageSize / s.count);
    const index_size = Math.ceil(s.totalIndexSize / s.count);
    print(`* ${num_per_object.toFixed(2)} ${name}${' '.repeat(18 - name.length)} per object - Disk ${disk_size} Bytes | Indexes ${index_size} Bytes | Count ${s.count}`);
    disk_size_per_obj += num_per_object * disk_size;
    index_size_per_obj += num_per_object * index_size;
}

stat_col('objectmds');
stat_col('objectparts');
stat_col('objectmultiparts');
stat_col('datachunks');
stat_col('datablocks');

print(`* 1   Object (average) - Disk   : ${disk_size_per_obj.toFixed(2)} Bytes`);
print(`* 1   Object (average) - Memory : ${index_size_per_obj.toFixed(2)} Bytes (${(index_size_per_obj * 100 / disk_size_per_obj).toFixed(1)}% of disk size)`);
print(`* 100 Million Objects  - Disk   : ${(disk_size_per_obj * 100 / 1024).toFixed(2)} GB`);
print(`* 100 Million Objects  - Memory : ${(index_size_per_obj * 100 / 1024).toFixed(2)} GB`);
print(`* 1   Billion Objects  - Disk   : ${(disk_size_per_obj * 1000 / 1024).toFixed(2)} GB`);
print(`* 1   Billion Objects  - Memory : ${(index_size_per_obj * 1000 / 1024).toFixed(2)} GB`);

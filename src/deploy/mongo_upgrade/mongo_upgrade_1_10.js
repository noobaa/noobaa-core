/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
/* global setVerboseShell */
'use strict';

mongo_upgrade_1_10();

function mongo_upgrade_1_10() {
    print('\nMONGO UPGRADE 1.10 - START ...');
    setVerboseShell(true);
    update_md_indexes();
    print('\nMONGO UPGRADE 1.10 - DONE.');
}

function update_md_indexes() {
    print('');
    print('update_md_indexes: dropping old indexes from metadata collections');
    print('update_md_indexes: printing existing indexes before dropping');

    print('');
    print('update_md_indexes: existing indexes from db.objectmds:');
    printjson(db.objectmds.stats().indexSizes);
    printjson(db.objectmds.getIndexes());

    print('');
    print('update_md_indexes: existing indexes from db.objectparts:');
    printjson(db.objectparts.stats().indexSizes);
    printjson(db.objectparts.getIndexes());

    print('');
    print('update_md_indexes: existing indexes from db.datachunks:');
    printjson(db.datachunks.stats().indexSizes);
    printjson(db.datachunks.getIndexes());

    print('');
    print('update_md_indexes: existing indexes from db.datablocks:');
    printjson(db.datablocks.stats().indexSizes);
    printjson(db.datablocks.getIndexes());

    print('');

    print('update_md_indexes: dropping indexes from db.objectmds: bucket_1_key_1_deleted_1');
    db.objectmds.dropIndex('bucket_1_key_1_deleted_1'); // replaced by bucket_1_key_1_deleted_1_upload_started_1 on version 1.8

    print('update_md_indexes: dropping indexes from db.objectparts: ' +
        'system_1_obj_1_upload_part_number_1_start_1_deleted_1, chunk_1_deleted_1, obj_1_deleted_1');
    db.objectparts.dropIndex('system_1_obj_1_upload_part_number_1_start_1_deleted_1');
    db.objectparts.dropIndex('chunk_1_deleted_1');
    db.objectparts.dropIndex('obj_1_deleted_1');

    print('update_md_indexes: dropping indexes from db.datachunks: system_1_digest_b64_1_deleted_1');
    db.datachunks.dropIndex('system_1_digest_b64_1_deleted_1');

    print('update_md_indexes: dropping indexes from db.datablocks: system_1_node_1_deleted_1, chunk_1_deleted_1');
    db.datablocks.dropIndex('system_1_node_1_deleted_1');
    db.datablocks.dropIndex('chunk_1_deleted_1');

    print('');
    print('update_md_indexes: done');
}

/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
/* global setVerboseShell */
'use strict';

mongo_upgrade_18();

function mongo_upgrade_18() {
    print('\nMONGO UPGRADE 18 - START ...');
    setVerboseShell(true);
    drop_objects_unique_index();
    print('\nMONGO UPGRADE 18 - DONE.');
}

function drop_objects_unique_index() {
    // new unique index includes additional field - upload_started
    // the index will be created when the server starts
    db.objectmds.dropIndex('bucket_1_key_1_deleted_1');
}

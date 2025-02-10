/* Copyright (C) 2016 NooBaa */
'use strict';


const coretest = require('./coretest');
const test_utils = require('../system_tests/test_utils');
coretest.setup({ incomplete_rpc_coverage: 'show' });

// ---------------------------------------
// Tests that does not require hosts pools
// ---------------------------------------

if (test_utils.invalid_nsfs_root_permissions()) {
    throw new Error(`Insufficient uid gid: pgid: ${process.getgid()}, puid: ${process.getuid()}`);
}

// // CORE
require('./test_nsfs_access');
require('./test_nsfs_integration');
require('./test_bucketspace_versioning');
require('./test_bucketspace_fs');
require('./test_nsfs_versioning');
require('./test_nc_cli');
require('./test_nc_health');


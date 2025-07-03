/* Copyright (C) 2016 NooBaa */
'use strict';


const coretest = require('../coretest/coretest');
const test_utils = require('../../system_tests/test_utils');
coretest.setup({ incomplete_rpc_coverage: 'show' });

// ---------------------------------------
// Tests that does not require hosts pools
// ---------------------------------------

if (test_utils.invalid_nsfs_root_permissions()) {
    throw new Error(`Insufficient uid gid: pgid: ${process.getgid()}, puid: ${process.getuid()}`);
}

// // CORE
require('../../unit_tests/nsfs/test_nsfs_access');
require('../../integration_tests/nsfs/test_nsfs_integration');
require('../../integration_tests/nsfs/test_bucketspace_versioning');
require('../../unit_tests/nsfs/test_bucketspace_fs');
require('../../unit_tests/nsfs/test_nsfs_versioning');
require('../../integration_tests/nc/cli/test_nc_cli');
require('../../integration_tests/nc/cli/test_nc_health');


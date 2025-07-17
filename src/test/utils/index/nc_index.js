/* Copyright (C) 2016 NooBaa */
'use strict';


const coretest = require('../coretest/nc_coretest');
coretest.setup();

require('../../unit_tests/nsfs/test_namespace_fs');
require('../../unit_tests/api/s3/test_ns_list_objects');
require('../../unit_tests/nsfs/test_namespace_fs_mpu');
require('../../unit_tests/native/test_nb_native_fs');
require('../../integration_tests/nc/cli/test_nc_cli');
require('../../integration_tests/nc/cli/test_nc_health');
require('../../unit_tests/nsfs/test_nsfs_access');
require('../../integration_tests/nsfs/test_nsfs_integration');
require('../../unit_tests/nsfs/test_bucketspace_fs');
require('../../unit_tests/nsfs/test_nsfs_glacier_backend');
require('../../integration_tests/api/s3/test_s3_bucket_policy');
require('../../unit_tests/nsfs/test_nsfs_versioning');
require('../../integration_tests/nsfs/test_bucketspace_versioning');
require('../../integration_tests/nc/cli/test_nc_bucket_logging');
require('../../integration_tests/nc/cli/test_nc_online_upgrade_s3_integrations');
require('../../integration_tests/api/s3/test_public_access_block');
require('../../integration_tests/nc/lifecycle/test_nc_lifecycle_expiration');
require('../../integration_tests/api/s3/test_chunked_upload');

// running with iam port
require('../../integration_tests/api/iam/test_nc_iam_basic_integration.js'); // please notice that we use a different setup
// running with a couple of forks - please notice and add only relevant tests here
require('../../integration_tests/nc/test_nc_with_a_couple_of_forks.js'); // please notice that we use a different setup

// TODO: uncomment when supported
//require('./test_s3_ops');
//require('./test_s3_list_objects');
//require('./test_s3_encryption');
// require('./test_s3select');

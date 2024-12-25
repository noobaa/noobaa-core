/* Copyright (C) 2016 NooBaa */
'use strict';


const coretest = require('./nc_coretest');
coretest.setup();

require('./test_namespace_fs');
require('./test_ns_list_objects');
require('./test_namespace_fs_mpu');
require('./test_nb_native_fs');
require('./test_nc_nsfs_cli');
require('./test_nc_health');
require('./test_nsfs_access');
require('./test_nsfs_integration');
require('./test_bucketspace_fs');
require('./test_nsfs_glacier_backend');
require('./test_s3_bucket_policy');
require('./test_nsfs_versioning');
require('./test_bucketspace_versioning');
require('./test_nc_bucket_logging');

// running with a couple of forks - please notice and add only relevant tests here
require('./test_nc_with_a_couple_of_forks.js'); // please notice that we use a different setup

// TODO: uncomment when supported
//require('./test_s3_ops');
//require('./test_s3_list_objects');
//require('./test_s3_encryption');
// require('./test_s3select');

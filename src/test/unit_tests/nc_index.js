/* Copyright (C) 2016 NooBaa */
'use strict';


const coretest = require('./nc_coretest');
coretest.setup();

require('./test_namespace_fs');
require('./test_ns_list_objects');
require('./test_chunk_fs');
require('./test_namespace_fs_mpu');
require('./test_nb_native_fs');
require('./test_nc_nsfs_cli');
require('./test_nc_nsfs_health');
require('./test_nsfs_access');
require('./test_bucketspace');
require('./test_bucketspace_fs');

// TODO: uncomment when supported
//require('./test_s3_ops');
//require('./test_s3_bucket_policy');
//require('./test_s3_list_objects');
//require('./test_s3_encryption');
// require('./test_s3select');
//require('./test_bucketspace_versioning');
//require('./test_nsfs_versioning');

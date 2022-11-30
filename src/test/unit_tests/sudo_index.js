/* Copyright (C) 2016 NooBaa */
/* eslint-disable global-require */
'use strict';


const coretest = require('./coretest');
coretest.setup({ incomplete_rpc_coverage: 'show' });

// ---------------------------------------
// Tests that does not require hosts pools
// ---------------------------------------


// // CORE
require('./test_nb_native_fs');
require('./test_namespace_fs');
require('./test_nsfs_versioning');
require('./test_ns_list_objects');
require('./test_bucketspace');
require('./test_bucketspace_versioning');


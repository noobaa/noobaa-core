/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({
    incomplete_rpc_coverage: 'show'
});

// CORE
require('./test_system_servers');
require('./test_node_server');
require('./test_host_server');
require('./test_agent');
require('./test_object_io');
require('./test_map_utils');
require('./test_s3_ops');
require('./test_s3_list_objects');
require('./test_md_store');
require('./test_nodes_store');
require('./test_system_store');
require('./test_md_aggregator_unit');

// UTILS
require('./test_job_queue');
require('./test_linked_list');
require('./test_keys_lock');
require('./test_lru');
require('./test_prefetch');
require('./test_promise_utils');
require('./test_rpc');
require('./test_semaphore');
require('./test_fs_utils');
require('./test_signature_utils');
require('./test_http_utils');
require('./test_v8_optimizations');
require('./test_native_core_crypto');
require('./test_zip_utils');
require('./test_wait_queue');
// require('./test_debug_module');

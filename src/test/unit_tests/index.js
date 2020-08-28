/* Copyright (C) 2016 NooBaa */
/* eslint-disable global-require */
'use strict';


const coretest = require('./coretest');
coretest.setup({ incomplete_rpc_coverage: 'show' });

// ---------------------------------------
// Tests that does not require hosts pools
// ---------------------------------------

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
// require('./test_ssl_utils');
require('./test_zip_utils');
require('./test_wait_queue');
require('./test_kmeans');
require('./test_sensitive_wrapper');
// require('./test_debug_module');
require('./test_range_stream');

// // STORES
require('./test_md_store');
require('./test_nodes_store');
require('./test_system_store');


// // CORE
// require('./test_mapper');
// require('./test_map_client');
//require('./test_map_reader');
require('./test_map_builder');
require('./test_map_deleter');
require('./test_chunk_coder');
require('./test_chunk_splitter');
require('./test_chunk_config_utils');
//require('./test_md_aggregator_unit');
require('./test_agent_blocks_verifier');
require('./test_s3_list_objects');
require('./test_nb_native_b64');
require('./test_bucket_chunks_builder');
require('./test_mirror_writer');

// // SERVERS
require('./test_agent');

// ------------------------------------
// A test that initialize the pool list
// ------------------------------------
require('./test_system_servers');

// ------------------------------
// Tests that require hosts pools
// ------------------------------

// SERVERS
require('./test_host_server');
require('./test_node_server');

// CORE
require('./test_map_reader'); /////////////
require('./test_object_io');
require('./test_agent_blocks_reclaimer');
require('./test_s3_ops');
require('./test_s3_encryption');
require('./test_s3_bucket_policy');
require('./test_node_allocator');
require('./test_namespace_cache');
// require('./test_tiering_upload');
//require('./test_s3_worm');

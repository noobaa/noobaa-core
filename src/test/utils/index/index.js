/* Copyright (C) 2016 NooBaa */
'use strict';


const coretest = require('../coretest/coretest');
coretest.setup({ incomplete_rpc_coverage: 'show' });

// ---------------------------------------
// Tests that does not require hosts pools
// ---------------------------------------

//JSON SCHEMA
require('../../unit_tests/db/test_schema_keywords');

// UTILS
require('../../unit_tests/util_functions_tests/test_linked_list');
require('../../unit_tests/util_functions_tests/test_keys_lock');
require('../../unit_tests/util_functions_tests/test_lru');
require('../../unit_tests/util_functions_tests/test_lru_cache');
require('../../unit_tests/util_functions_tests/test_prefetch');
require('../../unit_tests/util_functions_tests/test_promise_utils');
require('../../unit_tests/util_functions_tests/test_rpc');
require('../../unit_tests/util_functions_tests/test_semaphore');
require('../../unit_tests/util_functions_tests/test_delayed_trigger');
require('../../unit_tests/util_functions_tests/test_fs_utils');
require('../../unit_tests/util_functions_tests/test_signature_utils');
require('../../unit_tests/util_functions_tests/test_http_utils');
require('../../unit_tests/util_functions_tests/test_v8_optimizations');
require('../../unit_tests/util_functions_tests/test_ssl_utils');
require('../../unit_tests/util_functions_tests/test_zip_utils');
require('../../unit_tests/util_functions_tests/test_wait_queue');
require('../../unit_tests/util_functions_tests/test_kmeans');
require('../../unit_tests/util_functions_tests/test_sensitive_wrapper');
// require('./test_debug_module');
require('../../unit_tests/util_functions_tests/test_range_stream');
require('../../unit_tests/util_functions_tests/test_buffer_pool');

// // STORES
require('../../integration_tests/db/test_md_store');
require('../../integration_tests/db/test_nodes_store');
require('../../integration_tests/db/test_system_store');


// // CORE
// require('./test_mapper');
require('../../integration_tests/internal/test_map_client');
//require('./test_map_reader');
require('../../integration_tests/internal/test_map_deleter');
require('../../unit_tests/internal/test_chunk_coder');
require('../../unit_tests/internal/test_chunk_splitter');
require('../../unit_tests/internal/test_chunk_config_utils');
//require('./test_md_aggregator_unit');
require('../../integration_tests/internal/test_agent_blocks_verifier');
require('../../integration_tests/api/s3/test_s3_list_objects');
require('../../unit_tests/native/test_nb_native_b64');
require('../../unit_tests/internal/test_bucket_chunks_builder');
require('../../unit_tests/internal/test_mirror_writer');
require('../../unit_tests/nsfs/test_namespace_fs');
require('../../unit_tests/api/s3/test_ns_list_objects');
require('../../unit_tests/nsfs/test_namespace_fs_mpu');
require('../../unit_tests/native/test_nb_native_fs');
require('../../unit_tests/api/s3/test_s3select');
require('../../unit_tests/nsfs/test_nsfs_glacier_backend');

// // SERVERS

// ------------------------------------
// A test that initialize the pool list
// ------------------------------------
require('../../integration_tests/internal/test_system_servers');

// ------------------------------
// Tests that require hosts pools
// ------------------------------

// SERVERS
require('../../integration_tests/internal/test_host_server');
require('../../integration_tests/internal/test_node_server');

// CORE
require('../../integration_tests/internal/test_map_builder'); // Requires pools
require('../../integration_tests/internal/test_map_reader'); /////////////
require('../../integration_tests/internal/test_object_io');
require('../../integration_tests/internal/test_agent_blocks_reclaimer');
require('../../integration_tests/api/s3/test_s3_ops');
require('../../integration_tests/api/s3/test_s3_encryption');
require('../../integration_tests/api/s3/test_s3_bucket_policy');
// require('./test_node_allocator');
require('../../unit_tests/internal/test_namespace_cache');
require('../../integration_tests/api/s3/test_namespace_auth');
require('../../integration_tests/internal/test_encryption');
require('../../integration_tests/api/s3/test_bucket_replication');
require('../../integration_tests/api/sts/test_sts');
require('../../unit_tests/util_functions_tests/test_cloud_utils');
require('../../integration_tests/internal/test_upgrade_scripts.js');
require('../../integration_tests/internal/test_tiering_ttl_worker');
// require('./test_tiering_upload');
//require('../../integration_tests/api/s3/test_s3_worm.js');
require('../../integration_tests/api/s3/test_bucket_logging');
require('../../integration_tests/api/s3/test_notifications');
require('../../integration_tests/api/s3/test_chunked_upload');

// UPGRADE
// require('./test_postgres_upgrade'); // TODO currently working with mongo -> once changing to postgres - need to uncomment

// Lifecycle
require('../../integration_tests/api/s3/test_lifecycle');

// MD Sequence
require('../../integration_tests/db/test_mdsequence');

// Running with IAM port
require('../../integration_tests/api/iam/test_iam_basic_integration');
require('../../integration_tests/api/s3/test_s3_bucket_policy_iam_user');

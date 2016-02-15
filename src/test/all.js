'use strict';

/**
 * CORE
 */

require('./coretest').set_incomplete_rpc_coverage('show');
require('./test_system_servers');
require('./test_node_server');
require('./test_agent');
require('./test_object_driver');

/**
 * UTILS
 */

// require('./test_debug_module');
require('./test_dot');
require('./test_job_queue');
require('./test_linked_list');
require('./test_lru');
require('./test_mongoose_logger');
require('./test_prefetch');
require('./test_promise_utils');
require('./test_rpc');
require('./test_semaphore');
require('./test_wait_queue');

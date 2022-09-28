/* Copyright (C) 2022 NooBaa */
'use strict';
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

// make run-single-test-postgres testname=mdsequence_index.js
require('./test_mdsequence');


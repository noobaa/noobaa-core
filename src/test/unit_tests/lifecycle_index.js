/* Copyright (C) 2016 NooBaa */
/* eslint-disable global-require */
'use strict';


const coretest = require('./coretest');
coretest.setup({ incomplete_rpc_coverage: 'show' });


require('./test_lifecycle');


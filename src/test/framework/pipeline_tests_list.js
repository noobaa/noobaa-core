/* Copyright (C) 2016 NooBaa */
'use strict';

const tests = [{
    name: 'system-config',
    test: './src/test/pipeline/system_config.js',
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi'
}, {
    name: 'account-test',
    test: './src/test/pipeline/account_test.js',
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
}, {
    name: 'quota-test',
    test: './src/test/pipeline/quota_test.js',
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
}, {
    name: 'account-test-many-accounts',
    test: './src/test/pipeline/account_test.js',
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
    flags: {
        cycles: 1,
        accounts_number: 200,
        skip_delete: true,
    },
}, {
    name: 'namespace-test',
    test: './src/test/pipeline/namespace_test.js',
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
}, {
    name: 'namespace-cache-test',
    test: './src/test/pipeline/run_namespace_cache_tests.js',
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
}, ];

module.exports = tests;

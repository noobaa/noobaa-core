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
}, {
    name: 'namespace-cache-test',
    test: './src/test/pipeline/namespace_cache_test.js',
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
}, {
    name: 'dataset-test',
    test: './src/test/pipeline/run_dataset.js',
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
    flags: {
        agent_number: 3,
        aging_timeout: 60,
        dataset_size: (30 * 1024),
        size_units: 'MB',
    },
}, {
    name: 'dataset-test-large-files',
    test: './src/test/pipeline/run_dataset.js',
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
    flags: {
        agent_number: 3,
        aging_timeout: 60,
        file_size_low: 750,
        file_size_high: 4096,
        part_num_low: 20,
        part_num_high: 150,
        dataset_size: (30 * 1024),
        size_units: 'MB',
    },
}, ];

module.exports = tests;

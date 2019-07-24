/* Copyright (C) 2016 NooBaa */
'use strict';

const tests = [{
    name: 'system-config',
    test: './src/test/pipeline/system_config.js',
    num_agents: 0,
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi'
}, {
    name: 'account-test',
    test: './src/test/pipeline/account_test.js',
    num_agents: 0,
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
}, {
    name: 'account-test',
    test: './src/test/pipeline/account_test.js',
    num_agents: 0,
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
    num_agents: 0,
    server_cpu: '400m',
    server_mem: '400Mi',
    agent_cpu: '250m',
    agent_mem: '150Mi',
}, ];

module.exports = tests;

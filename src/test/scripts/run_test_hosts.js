/* Copyright (C) 2016 NooBaa */
'use strict';


const _ = require('lodash');
const argv = require('minimist')(process.argv);
const child_process = require('child_process');

const scale = argv.scale ? Number(argv.scale) : 1;

_.times(scale, i => child_process.fork('./src/agent/agent_cli.js', ['--run_s3', '--test_host', 'test_host_' + i]));

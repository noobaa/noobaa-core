/* Copyright (C) 2016 NooBaa */
'use strict';

const { Util } = require('@google-cloud/storage/build/src/nodejs-common/util');
const pkg = require('../../package.json');
const DEV_MODE = (process.env.DEV_MODE === 'true');

let stage_or_prod = 'production';
if (DEV_MODE) {
    stage_or_prod = 'staging';
}
Util.prototype.getUserAgentFromPackageJson = () => `NooBaa/${pkg.version} (GPN:noobaa.com; ${stage_or_prod}) NooBaa/${pkg.version}`;

const { Storage } = require('@google-cloud/storage');
module.exports = Storage;

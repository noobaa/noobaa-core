/* Copyright (C) 2016 NooBaa */
'use strict';

/*const { Util } = require('@google-cloud/storage/build/src/nodejs-common/util');
const pkg = require('../../package.json');
const DEV_MODE = (process.env.DEV_MODE === 'true');
*/
const crypto_utils = require('./crypto_utils');

/*let stage_or_prod = 'production';
if (DEV_MODE) {
    stage_or_prod = 'staging';
}
Util.prototype.getUserAgentFromPackageJson = () => `NooBaa/${pkg.version} (GPN:noobaa.com; ${stage_or_prod}) NooBaa/${pkg.version}`;
*/

const { Storage } = require('@google-cloud/storage');

Storage.calc_body_md5 = stream_file => crypto_utils.calc_body_md5(stream_file);

module.exports = Storage;

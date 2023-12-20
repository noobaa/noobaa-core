/* Copyright (C) 2016 NooBaa */
'use strict';

const crypto_utils = require('./crypto_utils');

const { Storage } = require('@google-cloud/storage');

Storage.calc_body_md5 = stream_file => crypto_utils.calc_body_md5(stream_file);

module.exports = Storage;

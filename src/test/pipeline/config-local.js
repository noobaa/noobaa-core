/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = config => {

    config.NAMESPACE_CACHING.DEFAULT_MAX_CACHE_OBJECT_SIZE = 4 * 1024 * 1024;
    config.NAMESPACE_CACHING.DISABLE_BUCKET_FREE_SPACE_CHECK = true;

};

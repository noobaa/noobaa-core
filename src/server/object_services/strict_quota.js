/* Copyright (C) 2026 NooBaa */
'use strict';


// TODO: Delete this file
function is_strict_quota(scope) {
    return Boolean(scope && scope.quota && scope.quota.mode === 'strict');
}

exports.is_strict_quota = is_strict_quota;

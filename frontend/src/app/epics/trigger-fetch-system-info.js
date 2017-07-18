/* Copyright (C) 2016 NooBaa */

import {
    COMPLETE_CREATE_ACCOUNT,
    COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    COMPLETE_UPDATE_BUCKET_QUOTA,
    COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
    COMPLETE_ADD_EXTERNAL_CONNECTION,
    COMPLETE_DELETE_RESOURCE,
    COMPLETE_CREATE_HOSTS_POOL,
    COMPLETE_ASSIGN_HOSTS_TO_POOL
} from 'action-types';
import { fetchSystemInfo } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(
            COMPLETE_CREATE_ACCOUNT,
            COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
            COMPLETE_UPDATE_BUCKET_QUOTA,
            COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
            COMPLETE_ADD_EXTERNAL_CONNECTION,
            COMPLETE_DELETE_RESOURCE,
            COMPLETE_CREATE_HOSTS_POOL,
            COMPLETE_ASSIGN_HOSTS_TO_POOL
        )
        .map(() => fetchSystemInfo());
}

/* Copyright (C) 2016 NooBaa */

import {
    COMPLETE_CREATE_ACCOUNT,
    COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    COMPLETE_UPDATE_BUCKET_QUOTA,
    COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
    COMPLETE_ADD_EXTERNAL_CONNECTION,
    COMPLETE_UPDATE_BUCKET_SPILLOVER
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
            COMPLETE_UPDATE_BUCKET_SPILLOVER
        )
        .map(() => fetchSystemInfo());
}

/* Copyright (C) 2016 NooBaa */

import { refreshLocation } from 'action-creators';
import * as types from 'action-types';

export default function(action$) {
    return action$
        .ofType(
            types.COMPLETE_CREATE_ACCOUNT,
            types.COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
            types.COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
            types.COMPLETE_ADD_EXTERNAL_CONNECTION,
            types.COMPLETE_DELETE_RESOURCE,
            types.COMPLETE_DELETE_EXTERNAL_CONNECTION,
            types.COMPLETE_CREATE_HOSTS_POOL,
            types.COMPLETE_ASSIGN_HOSTS_TO_POOL,
            types.COMPLETE_SET_HOST_DEBUG_MODE,
            types.COMPLETE_TOGGLE_HOST_SERVICES,
            types.COMPLETE_TOGGLE_HOST_NODES,
            types.COMPLETE_DELETE_ACCOUNT,
            types.COMPLETE_CREATE_NAMESPACE_RESOURCE,
            types.COMPLETE_DELETE_NAMESPACE_RESOURCE,
            types.COMPLETE_UPDATE_BUCKET_QUOTA,
            types.COMPLETE_TOGGLE_BUCKET_SPILLOVER,
            types.COMPLETE_TOGGLE_BUCKETS_SPILLOVER,
            types.COMPLETE_UPDATE_BUCKET_PLACEMENT_POLICY,
            types.COMPLETE_UPDATE_BUCKET_RESILIENCY_POLICY,
            types.COMPLETE_DELETE_BUCKET,
            types.COMPLETE_CREATE_NAMESPACE_BUCKET,
            types.COMPLETE_UPDATE_NAMESPACE_BUCKET_PLACEMENT,
            types.COMPLETE_DELETE_NAMESPACE_BUCKET,
            types.COMPLETE_RETRUST_HOST,
            types.COMPLETE_DELETE_HOST,
            types.COMPLETE_DELETE_OBJECT,
            types.UPLOAD_OBJECTS,
            types.COMPLETE_OBJECT_UPLOAD,
            types.COMPLETE_INVOKE_UPGRADE_SYSTEM,
            types.REMOVE_HOST,
            types.COMPLETE_UPDATE_BUCKET_S3_ACCESS,
            types.COMPLETE_DELETE_CLOUD_SYNC_POLICY,
            types.COMPLETE_TOGGLE_CLOUD_SYNC_POLICY,
            types.COMPLETE_ADD_BUCKET_TRIGGER,
            types.COMPLETE_UPDATE_BUCKET_TRIGGER,
            types.COMPLETE_REMOVE_BUCKET_TRIGGER
        )
        .map(() => refreshLocation());
}

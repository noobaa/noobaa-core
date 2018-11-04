/* Copyright (C) 2016 NooBaa */

import { map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { refreshLocation } from 'action-creators';
import * as types from 'action-types';

export default function(action$) {
    return action$.pipe(
        ofType(
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
            types.COMPLETE_UPDATE_BUCKET_QUOTA_POLICY,
            types.COMPLETE_UPDATE_BUCKET_RESILIENCY_POLICY,
            types.COMPLETE_UPDATE_BUCKET_VERSIONING_POLICY,
            types.COMPLETE_ADD_BUCKET_TIER,
            types.COMPLETE_DELETE_BUCKET,
            types.COMPLETE_UPDATE_TIER_PLACEMENT_POLICY,
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
            types.COMPLETE_ADD_BUCKET_TRIGGER,
            types.COMPLETE_UPDATE_BUCKET_TRIGGER,
            types.COMPLETE_REMOVE_BUCKET_TRIGGER,
            types.COMPLETE_ATTACH_SERVER_TO_CLUSTER,
            types.COMPLETE_CREATE_CLOUD_RESOURCE,
            types.COMPLETE_UPDATE_REMOTE_SYSLOG,
            types.COMPLETE_CREATE_LAMBDA_FUNC,
            types.COMPLETE_UPDATE_LAMBDA_FUNC_CONFIG,
            types.COMPLETE_UPDATE_LAMBDA_FUNC_CODE,
            types.COMPLETE_DELETE_LAMBDA_FUNC,
            types.COMPLETE_ENTER_MAINTENANCE_MODE,
            types.COMPLETE_LEAVE_MAINTENANCE_MODE,
            types.COMPLETE_CREATE_BUCKET,
            types.COMPLETE_REGENERATE_ACCOUNT_CREDENTIALS,
            types.COMPLETE_ASSIGN_REGION_TO_RESOURCE,
            types.COMPLETE_INSTALL_VM_TOOLS,
            types.COMPLETE_UPDATE_P2P_SETTINGS,
            types.COMPLETE_UPDATE_PROXY_SERVER_SETTINGS,
            types.COMPLETE_SET_SYSTEM_DEBUG_LEVEL,
        ),
        map(() => refreshLocation())
    );
}

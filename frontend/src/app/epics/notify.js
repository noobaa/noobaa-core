/* Copyright (C) 2016 NooBaa */

import { deepFreeze, ensureArray, isDefined } from 'utils/core-utils';
import { getHostDisplayName, getHostServiceDisplayName } from 'utils/host-utils';
import { getServerDisplayName } from 'utils/cluster-utils';
import { unitsInBytes } from 'utils/size-utils';
import { showNotification } from 'action-creators';
import { empty } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import * as types from 'action-types';

const actionToNotification = deepFreeze({
    [types.FAIL_CREATE_ACCOUNT]: ({ accountName }) => ({
        message: `Creating account ${accountName} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_ACCOUNT_S3_ACCESS]: ({ accountName }) => ({
        message: `${accountName} S3 access updated successfully`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_ACCOUNT_S3_ACCESS]: ({ accountName }) => ({
        message: `Updating ${accountName} S3 access failed`,
        severity: 'error'
    }),

    [types.COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS]: ({ accountName }) => ({
        message: `IP restrictions for ${accountName} set successfully`,
        severity: 'success'
    }),

    [types.FAIL_SET_ACCOUNT_IP_RESTRICTIONS]: ({ accountName }) => ({
        message: `Setting IP restrictions for ${accountName} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_CHANGE_ACCOUNT_PASSWORD]: ({ accountName }) => ({
        message: `${accountName} password changed successfully`,
        severity: 'success'
    }),

    [types.FAIL_CHANGE_ACCOUNT_PASSWORD]: ({ accountName }) => ({
        message: `Changing ${accountName} password failed`,
        severity: 'error'
    }),

    [types.COMPLETE_REGENERATE_ACCOUNT_CREDENTIALS]: ({ accountName }) => ({
        message: `${accountName} credentials regenerated successfully`,
        severity: 'success'
    }),

    [types.FAIL_REGENERATE_ACCOUNT_CREDENTIALS]: ({ accountName }) => ({
        message: `Regenerating ${accountName} credentials failed`,
        severity: 'error'
    }),

    [types.COMPLETE_ADD_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Adding ${connection} completed successfully`,
        severity: 'success'
    }),

    [types.FAIL_ADD_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Adding ${connection} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_DELETE_RESOURCE]: ({ resource }) => ({
        message: `Resource ${resource} deleted successfully`,
        severity: 'success'
    }),

    [types.FAIL_DELETE_RESOURCE]: ({ resource }) => ({
        message: `Resource ${resource} deletion failed`,
        severity: 'error'
    }),

    [types.COLLECT_HOST_DIAGNOSTICS]: ({ host }) => ({
        message: `Collecting diagnostic for ${getHostDisplayName(host)}, it may take a few seconds`,
        severity: 'success'
    }),

    [types.FAIL_COLLECT_HOST_DIAGNOSTICS]: ({ host }) => ({
        message: `Collecting diagnostic file for ${getHostDisplayName(host)} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_SET_HOST_DEBUG_MODE]: ({ host, on }) => ({
        message: `Debug mode was turned ${on ? 'on' : 'off'} for node ${getHostDisplayName(host)}`,
        severity: 'success'
    }),

    [types.FAIL_SET_HOST_DEBUG_MODE]: ({ host, on }) => ({
        message: `Could not turn ${on ? 'on' : 'off'} debug mode for node ${getHostDisplayName(host)}`,
        severity: 'error'
    }),

    [types.COMPLETE_CREATE_HOSTS_POOL]: ({ name }) => ({
        message: `Pool ${name} created successfully`,
        severity: 'success'
    }),

    [types.FAIL_CREATE_HOSTS_POOL]: ({ name }) => ({
        message: `Pool ${name} creation failed`,
        severity: 'error'
    }),

    [types.COMPLETE_ASSIGN_HOSTS_TO_POOL]: ({ pool, hosts }) => ({
        message: `${hosts.length} nodes has been assigend to pool ${pool}`,
        severity: 'success'
    }),

    [types.FAIL_ASSIGN_HOSTS_TO_POOL]: ({ pool }) => ({
        message: `Assinging nodes to pool ${pool} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_TOGGLE_HOST_SERVICES]: ({ host, services }) => {
        return Object.entries(services)
            .filter(pair => {
                const [ /* service */, state ] = pair;
                return isDefined(state);
            })
            .map(pair => {
                const [ service, state ] = pair;
                const hostName = getHostDisplayName(host);
                const serviceName = getHostServiceDisplayName(service).toLowerCase();
                const action = state ? 'enabled' : 'disabled';

                return {
                    message: `${hostName} ${serviceName} service ${action} successfully`,
                    severity: 'success'
                };
            });
    },

    [types.FAIL_TOGGLE_HOST_SERVICES]: ({ host, services }) => {
        return Object.entries(services)
            .filter(pair => {
                const [ /* service */, state ] = pair;
                return isDefined(state);
            })
            .map(pair => {
                const [ service, state ] = pair;
                const hostName = getHostDisplayName(host);
                const serviceName = getHostServiceDisplayName(service).toLowerCase();
                const action = state ? 'enabling' : 'disabling';

                return {
                    message: `${action} ${hostName} ${serviceName} service failed`,
                    severity: 'error'
                };
            });
    },

    [types.COMPLETE_TOGGLE_HOST_NODES]: ({ host }) => ({
        message: `${getHostDisplayName(host)} storage drives updated successfully`,
        severity: 'success'
    }),

    [types.FAIL_TOGGLE_HOST_NODES]: ({ host }) => ({
        message: `Updating ${getHostDisplayName(host)} storage drives failed`,
        severity: 'error'
    }),

    [types.COMPLETE_DELETE_ACCOUNT]: ({ email }) => ({
        message: `Account ${email} deleted successfully`,
        severity: 'success'
    }),

    [types.FAIL_DELETE_ACCOUNT]: ({ email }) => ({
        message: `Account ${email} deletion failed`,
        severity: 'error'
    }),

    [types.COMPLETE_DELETE_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Connection ${connection} deleted successfully`,
        severity: 'success'
    }),

    [types.FAIL_DELETE_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Connection ${connection} deletion failed`,
        severity: 'error'
    }),

    [types.COMPLETE_CREATE_NAMESPACE_RESOURCE]: ({ name }) => ({
        message: `Namespace resource ${name} created successfully`,
        severity: 'success'
    }),

    [types.FAIL_CREATE_NAMSPACE_RESOURCE]: ({ name }) => ({
        message: `Namespace resource ${name} creation failed`,
        severity: 'error'
    }),

    [types.COMPLETE_DELETE_NAMESPACE_RESOURCE]: ({ name }) => ({
        message: `Namespace resource ${name} deleted successfully`,
        severity: 'success'
    }),

    [types.FAIL_DELETE_NAMSPACE_RESOURCE]: ({ name }) => ({
        message: `Namespace resource ${name} deletion failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_BUCKET_QUOTA]: ({ bucket }) => ({
        message: `${bucket} quota updated successfully`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_BUCKET_QUOTA]: ({ bucket }) => ({
        message: `Updating quota for ${bucket} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_BUCKET_PLACEMENT_POLICY]: ({ bucket }) => ({
        message: `${bucket} placement policy updated successfully`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_BUCKET_PLACEMENT_POLICY]: ({ bucket }) => ({
        message: `Updating ${bucket} placement policy failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_BUCKET_RESILIENCY_POLICY]: ({ bucket }) => ({
        message: `${bucket} resiliency policy updated successfully`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_BUCKET_RESILIENCY_POLICY]: ({ bucket }) => ({
        message: `Updating ${bucket} resiliency policy failed`,
        severity: 'error'
    }),

    [types.COMPLETE_DELETE_BUCKET]: ({ bucket }) => ({
        message: `Bucket ${bucket} deleted successfully`,
        severity:'success'
    }),

    [types.FAIL_DELETE_BUCKET]: ({ bucket }) => ({
        message: `Bucket ${bucket} deletion failed`,
        severity: 'error'
    }),

    [types.COMPLETE_CREATE_NAMESPACE_BUCKET]: ({ name }) =>({
        message: `Namespace bucket ${name} created successfully`,
        severity: 'success'
    }),

    [types.FAIL_CREATE_NAMESPACE_BUCKET]: ({ name }) => ({
        message: `Namespace bucket ${name} creation failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_NAMESPACE_BUCKET_PLACEMENT]: ({ name }) => ({
        message: `Namespace bucket ${name} placement policy updated successfully`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_NAMESPACE_BUCKET_PLACEMENT]: ({ name }) => ({
        message: `Updating namespace bucket ${name} placement policy failed`,
        severity: 'error'
    }),

    [types.COMPLETE_DELETE_NAMESPACE_BUCKET]: ({ name }) => ({
        message: `Namespace bucket ${name} deleted successfully`,
        severity: 'success'
    }),

    [types.FAIL_DELETE_NAMESPACE_BUCKET]: ({ name }) => ({
        message: `Namespace bucket ${name} deletion failed`,
        severity: 'error'
    }),

    [types.COMPLETE_RETRUST_HOST]: ({ host }) => ({
        message: `Node ${host} was set as trusted successfully`,
        severity: 'success'
    }),

    [types.FAIL_RETRUST_HOST]: ({ host }) => ({
        message: `Set node ${host} as trusted failed `,
        severity: 'error'
    }),

    [types.COMPLETE_DELETE_OBJECT]: ({ key }) => ({
        message: `File ${key} deleted successfully`,
        severity: 'success'
    }),

    [types.FAIL_DELETE_OBJECT]: ({ key }) => ({
        message: `File ${key} deletion failed`,
        severity: 'error'
    }),

    [types.COMPLETE_DELETE_HOST]: () => ({
        message: 'Node deletion process has started, The node will be removed once all stored data is secured',
        severity: 'info'
    }),

    [types.FAIL_DELETE_HOST]: ({ host }) => ({
        message: `Host ${host} deletion failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_SERVER_ADDRESS]: ({ secret, hostname }) => ({
        message: `${getServerDisplayName({ secret, hostname })} cluster connectivity IP updated successfully`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_SERVER_ADDRESS]: ({ secret, hostname }) => ({
        message: `Updating cluster connectivity IP for ${getServerDisplayName({ secret, hostname })} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_BUCKET_S3_ACCESS]: ({ bucketName }) => ({
        message: `${bucketName} S3 access control updated successfully`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_BUCKET_S3_ACCESS]: ({ bucketName }) => ({
        message: `Updating ${bucketName} S3 access control failed`,
        severity: 'error'
    }),

    [types.COMPLETE_ADD_BUCKET_TRIGGER]: ({ bucketName }) => ({
        message: `A trigger added to ${bucketName} successfully`,
        severity: 'success'
    }),

    [types.FAIL_ADD_BUCKET_TRIGGER]: ({ bucketName }) => ({
        message: `Adding a trigger to ${bucketName} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_BUCKET_TRIGGER]: ({ bucketName }) => ({
        message: `A trigger updated for ${bucketName} successfully`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_BUCKET_TRIGGER]: ({ bucketName }) => ({
        message: `Updating a trigger for ${bucketName} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_REMOVE_BUCKET_TRIGGER]: ({ bucketName }) => ({
        message: `A trigger removed from ${bucketName} successfully`,
        severity: 'success'
    }),

    [types.FAIL_REMOVE_BUCKET_TRIGGER]: ({ bucketName }) => ({
        message: `Removing a trigger from ${bucketName} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_ATTACH_SERVER_TO_CLUSTER]: ({ secret, hostname }) => ({
        message: `Attaching ${getServerDisplayName({ secret, hostname })} to the cluster, this might take a few moments`,
        severity: 'info'
    }),

    [types.FAIL_ATTACH_SERVER_TO_CLUSTER]: ({ secret, hostname }) => ({
        message: `Attaching ${getServerDisplayName({ secret, hostname })} to cluster failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_BUCKET_SPILLOVER]: ({ bucket }) => ({
        message: `${bucket} spillover policy was updated successfully`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_BUCKET_SPILLOVER]: ({ bucket }) => ({
        message: `Updating spillover policy for ${bucket} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_CREATE_CLOUD_RESOURCE]: ({ name }) => ({
        message: `Cloud resource ${name} created successfully`,
        severity: 'success'
    }),

    [types.FAIL_CREATE_CLOUD_RESOURCE]: ({ name }) => ({
        message: `Cloud resource ${name} creation failed`,
        severity: 'error'
    }),

    [types.COMPLETE_UPDATE_REMOTE_SYSLOG]: ({ enabled }) => ({
        message: `Remote syslog has been ${enabled ? 'enabled' : 'disabled'}`,
        severity: 'success'
    }),

    [types.FAIL_UPDATE_REMOTE_SYSLOG]: ({ enabled }) => ({
        message: `${ enabled ? 'Enabling' : 'Disabling'} remote syslog failed`,
        severity: 'error'
    }),

    [types.CREATE_LAMBDA_FUNC]: ({ codeBufferSize }) => {
        if (codeBufferSize < 10 * unitsInBytes.MEGABYTE) {
            return;
        }

        return {
            message: 'Uploading a large function package, it may take a few moments',
            severity: 'info'
        };
    },

    [types.COMPLETE_CREATE_LAMBDA_FUNC]: ({ name }) => ({
        message: `Function ${name} created successfully`,
        severity: 'success'
    }),

    [types.FAIL_CREATE_LAMBDA_FUNC]: ({ name }) => ({
        message: `Creating function ${name} failed`,
        severity: 'error'
    }),

    [types.COMPLETE_ENTER_MAINTENANCE_MODE]: () => ({
        message: 'entered maintenance mode successfully',
        severity: 'success'
    }),

    [types.FAIL_ENTER_MAINTENANCE_MODE]: () => ({
        message: 'Enter maintenance mode failed',
        severity: 'error'
    }),

    [types.COMPLETE_LEAVE_MAINTENANCE_MODE]: () => ({
        message: 'Leaved maintenance mode successfully',
        severity: 'success'
    }),

    [types.FAIL_LEAVE_MAINTENANCE_MODE]: () => ({
        message: 'Leave maintenance mode failed',
        severity: 'error'
    }),

    [types.COMPLETE_CREATE_BUCKET]: ({ name }) => ({
        message: `Bucket ${name} created successfully`,
        severity: 'success'
    }),

    [types.FAIL_CREATE_BUCKET]: ({ name }) => ({
        message: `Bucket ${name} creation failed`,
        severity: 'error'
    }),

    [types.COMPLETE_OBJECTS_UPLOAD]: ({ successCount }) => ({
        message: `${successCount} files uploaded successfully`,
        severity: 'success'
    }),

    [types.FAIL_OBJECT_UPLOAD]: ({ name }) => ({
        message: `Failed to upload ${name}, please check connectivity or bucket S3 permissions`,
        severity: 'error'
    })
});

export default function(action$) {
    return action$.pipe(
        mergeMap(action => {
            const generator = actionToNotification[action.type];
            if (generator){
                return ensureArray(generator(action.payload))
                    .map(notif => showNotification(notif.message, notif.severity));
            } else {
                return empty();
            }
        })
    );
}

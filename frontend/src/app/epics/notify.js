import { deepFreeze, ensureArray, isDefined } from 'utils/core-utils';
import { getHostDisplayName, getHostServiceDisplayName } from 'utils/host-utils';
import { showNotification } from 'action-creators';
import Rx from 'rx';
import {
    FAIL_CREATE_ACCOUNT,
    COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_UPDATE_ACCOUNT_S3_ACCESS,
    COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
    FAIL_SET_ACCOUNT_IP_RESTRICTIONS,
    COMPLETE_CHANGE_ACCOUNT_PASSWORD,
    FAIL_CHANGE_ACCOUNT_PASSWORD,
    COMPLETE_UPDATE_BUCKET_QUOTA,
    FAIL_UPDATE_BUCKET_QUOTA,
    COMPLETE_ADD_EXTERNAL_CONNECTION,
    FAIL_ADD_EXTERNAL_CONNECTION,
    COMPLETE_DELETE_RESOURCE,
    FAIL_DELETE_RESOURCE,
    COLLECT_HOST_DIAGNOSTICS,
    FAIL_COLLECT_HOST_DIAGNOSTICS,
    COMPLETE_SET_HOST_DEBUG_MODE,
    FAIL_SET_HOST_DEBUG_MODE,
    COMPLETE_CREATE_HOSTS_POOL,
    FAIL_CREATE_HOSTS_POOL,
    COMPLETE_ASSIGN_HOSTS_TO_POOL,
    FAIL_ASSIGN_HOSTS_TO_POOL,
    COMPLETE_TOGGLE_HOST_SERVICES,
    FAIL_TOGGLE_HOST_SERVICES,
    COMPLETE_TOGGLE_HOST_NODES,
    FAIL_TOGGLE_HOST_NODES,
    COMPLETE_DELETE_ACCOUNT,
    FAIL_DELETE_ACCOUNT,
    COMPLETE_DELETE_EXTERNAL_CONNECTION,
    FAIL_DELETE_EXTERNAL_CONNECTION,
    COMPLETE_CREATE_NAMESPACE_RESOURCE,
    FAIL_CREATE_NAMSPACE_RESOURCE,
    COMPLETE_DELETE_NAMESPACE_RESOURCE,
    FAIL_DELETE_NAMSPACE_RESOURCE,
    COMPLETE_CREATE_GATEWAY_BUCKET,
    FAIL_CREATE_GATEWAY_BUCKET,
    COMPLETE_UPDATE_GATEWAY_BUCKET_PLACEMENT,
    FAIL_UPDATE_GATEWAY_BUCKET_PLACEMENT,
    COMPLETE_DELETE_GATEWAY_BUCKET,
    FAIL_DELETE_GATEWAY_BUCKET

} from 'action-types';

const actionToNotification = deepFreeze({
    [FAIL_CREATE_ACCOUNT]: ({ accountName }) => ({
        message: `Creating account ${accountName} failed`,
        severity: 'error'
    }),

    [COMPLETE_UPDATE_ACCOUNT_S3_ACCESS]: ({ accountName }) => ({
        message: `${accountName} S3 access updated successfully`,
        severity: 'success'
    }),

    [FAIL_UPDATE_ACCOUNT_S3_ACCESS]: ({ accountName }) => ({
        message: `Updating ${accountName} S3 access failed`,
        severity: 'error'
    }),

    [COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS]: ({ accountName }) => ({
        message: `IP restrictions for ${accountName} set successfully`,
        severity: 'success'
    }),

    [FAIL_SET_ACCOUNT_IP_RESTRICTIONS]: ({ accountName }) => ({
        message: `Setting IP restrictions for ${accountName} failed`,
        severity: 'error'
    }),

    [COMPLETE_CHANGE_ACCOUNT_PASSWORD]: ({ accountName }) => ({
        message: `${accountName} password changed successfully`,
        severity: 'success'
    }),

    [FAIL_CHANGE_ACCOUNT_PASSWORD]: ({ accountName }) => ({
        message: `Changing ${accountName} password failed`,
        severity: 'error'
    }),

    [COMPLETE_UPDATE_BUCKET_QUOTA]: ({ bucket }) => ({
        message: `${bucket} quota updated successfully`,
        severity: 'success'
    }),

    [FAIL_UPDATE_BUCKET_QUOTA]: ({ bucket }) => ({
        message: `Updating quota for ${bucket} failed`,
        severity: 'error'
    }),

    [COMPLETE_ADD_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Adding ${connection} completed successfully`,
        severity: 'success'
    }),

    [FAIL_ADD_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Adding ${connection} failed`,
        severity: 'error'
    }),

    [COMPLETE_DELETE_RESOURCE]: ({ resource }) => ({
        message: `Resource ${resource} deleted successfully`,
        severity: 'success'
    }),

    [FAIL_DELETE_RESOURCE]: ({ resource }) => ({
        message: `Resource ${resource} deletion failed`,
        severity: 'error'
    }),

    [COLLECT_HOST_DIAGNOSTICS]: ({ host }) => ({
        message: `Collecting diagnostic for ${getHostDisplayName(host)}, it may take a few seconds`,
        severity: 'success'
    }),

    [FAIL_COLLECT_HOST_DIAGNOSTICS]: ({ host }) => ({
        message: `Collecting diagnostic file for ${getHostDisplayName(host)} failed`,
        severity: 'error'
    }),

    [COMPLETE_SET_HOST_DEBUG_MODE]: ({ host, on }) => ({
        message: `Debug mode was turned ${on ? 'on' : 'off'} for node ${getHostDisplayName(host)}`,
        severity: 'success'
    }),

    [FAIL_SET_HOST_DEBUG_MODE]: ({ host, on }) => ({
        message: `Could not turn ${on ? 'on' : 'off'} debug mode for node ${getHostDisplayName(host)}`,
        severity: 'error'
    }),

    [COMPLETE_CREATE_HOSTS_POOL]: ({ name }) => ({
        message: `Pool ${name} created successfully`,
        severity: 'success'
    }),

    [FAIL_CREATE_HOSTS_POOL]: ({ name }) => ({
        message: `Pool ${name} creation failed`,
        severity: 'error'
    }),

    [COMPLETE_ASSIGN_HOSTS_TO_POOL]: ({ pool, hosts }) => ({
        message: `${hosts.length} nodes has been assigend to pool ${pool}`,
        severity: 'success'
    }),

    [FAIL_ASSIGN_HOSTS_TO_POOL]: ({ pool }) => ({
        message: `Assinging nodes to pool ${pool} failed`,
        severity: 'error'
    }),

    [COMPLETE_TOGGLE_HOST_SERVICES]: ({ host, services }) => {
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

    [FAIL_TOGGLE_HOST_SERVICES]: ({ host, services }) => {
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

    [COMPLETE_TOGGLE_HOST_NODES]: ({ host }) => ({
        message: `${getHostDisplayName(host)} storage drives updated successfully`,
        severity: 'success'
    }),

    [FAIL_TOGGLE_HOST_NODES]: ({ host }) => ({
        message: `Updating ${getHostDisplayName(host)} storage drives failed`,
        severity: 'error'
    }),

    [COMPLETE_DELETE_ACCOUNT]: ({ email }) => ({
        message: `Account ${email} deleted successfully`,
        severity: 'success'
    }),

    [FAIL_DELETE_ACCOUNT]: ({ email }) => ({
        message: `Account ${email} deletion failed`,
        severity: 'error'
    }),

    [COMPLETE_DELETE_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Connection ${connection} deleted successfully`,
        severity: 'success'
    }),

    [FAIL_DELETE_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Connection ${connection} deletion failed`,
        severity: 'error'
    }),

    [COMPLETE_CREATE_NAMESPACE_RESOURCE]: ({ name }) => ({
        message: `Namespace resource ${name} created successfully`,
        severity: 'success'
    }),

    [FAIL_CREATE_NAMSPACE_RESOURCE]: ({ name }) => ({
        message: `Namespace resource ${name} creation failed`,
        severity: 'error'
    }),

    [COMPLETE_DELETE_NAMESPACE_RESOURCE]: ({ name }) => ({
        message: `Namespace resource ${name} deleted successfully`,
        severity: 'success'
    }),

    [FAIL_DELETE_NAMSPACE_RESOURCE]: ({ name }) => ({
        message: `Namespace resource ${name} deletion failed`,
        severity: 'error'
    }),

    [COMPLETE_CREATE_GATEWAY_BUCKET]: ({ name }) =>({
        message: `Gateway bucket ${name} created successfully`,
        severity: 'success'
    }),

    [FAIL_CREATE_GATEWAY_BUCKET]: ({ name }) => ({
        message: `Gateway bucket ${name} creation failed`,
        severity: 'error'
    }),

    [COMPLETE_UPDATE_GATEWAY_BUCKET_PLACEMENT]: ({ name }) => ({
        message: `Gateway bucket ${name} placement policy updated successfully`,
        severity: 'success'
    }),

    [FAIL_UPDATE_GATEWAY_BUCKET_PLACEMENT]: ({ name }) => ({
        message: `Updating gateway bucket ${name} placement policy failed`,
        severity: 'error'
    }),

    [COMPLETE_DELETE_GATEWAY_BUCKET]: ({ name }) => ({
        message: `Gateway bucket ${name} deleted successfully`,
        severity: 'success'
    }),

    [FAIL_DELETE_GATEWAY_BUCKET]: ({ name }) => ({
        message: `Gateway bucket ${name} deletion failed`,
        severity: 'error'
    }),
});

export default function(action$) {
    return action$
        .flatMap(action => {
            const generator = actionToNotification[action.type];
            if (generator){
                return ensureArray(generator(action.payload))
                    .map(notif => showNotification(notif.message, notif.severity));
            } else {
                return Rx.Observable.empty();
            }
        });
}

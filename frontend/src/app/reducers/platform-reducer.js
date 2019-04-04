/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyBy, echo } from 'utils/core-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    const restrictions = keyBy(
        payload.platform_restrictions,
        echo,
        () => true
    );

    return {
        kind: 'UNKNOWN',
        featureFlags: {
            vmToolsInstallation: !restrictions.vmtools,
            serverClockConfig: !restrictions.time_config,
            systemAddressChange: !restrictions.dns_name,
            dnsServersChange: !restrictions.dns_server,
            serverAttachment: !restrictions.attach_server,
            p2pSettingsChange: !restrictions.peer_to_peer_ports,
            serverDetailsChange: !restrictions.server_details,
            clusterConnectivityIpChange: !restrictions.cluster_connectivity_ip,
            toggleEndpointAgent: !restrictions.toggle_endpoint_agent
        }
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});

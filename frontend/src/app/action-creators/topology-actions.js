import {
    UPDATE_SERVER_ADDRESS,
    COMPLETE_UPDATE_SERVER_ADDRESS,
    FAIL_UPDATE_SERVER_ADDRESS,
    ATTACH_SERVER_TO_CLUSTER,
    COMPLETE_ATTACH_SERVER_TO_CLUSTER,
    FAIL_ATTACH_SERVER_TO_CLUSTER,
    UPDATE_SERVER_DNS_SETTINGS,
    COMPLETE_UPDATE_SERVER_DNS_SETTINGS,
    FAIL_UPDATE_SERVER_DNS_SETTINGS,
    UPDATE_SERVER_DETAILS,
    COMPLETE_UPDATE_SERVER_DETAILS,
    FAIL_UPDATE_SERVER_DETAILS,
    UPDATE_SERVER_TIME_SETTINGS,
    COMPLETE_UPDATE_SERVER_TIME_SETTINGS,
    FAIL_UPDATE_SERVER_TIME_SETTINGS
} from 'action-types';

export function updateServerAddress(secret, newAddress, hostname) {
    return {
        type: UPDATE_SERVER_ADDRESS,
        payload: { secret, newAddress, hostname }
    };
}

export function completeUpdateServerAddress(secret, hostname) {
    return {
        type: COMPLETE_UPDATE_SERVER_ADDRESS,
        payload: { secret, hostname }
    };
}

export function failUpdateServerAddress(secret, hostname, error) {
    return {
        type: FAIL_UPDATE_SERVER_ADDRESS,
        payload: { secret, hostname, error }
    };
}

export function attachServerToCluster(secret, address, hostname, location) {

    return {
        type: ATTACH_SERVER_TO_CLUSTER,
        payload: { secret, address, hostname, location }
    };
}

export function completeAttachServerToCluster(secret) {
    return {
        type: COMPLETE_ATTACH_SERVER_TO_CLUSTER,
        payload: { secret }
    };
}

export function failAttachServerToCluster(secret, error) {
    return {
        type: FAIL_ATTACH_SERVER_TO_CLUSTER,
        payload: { secret, error }
    };
}

export function updateServerDNSSettings(
    secret,
    hostname,
    primaryDNS,
    secondaryDNS,
    searchDomains
) {
    return {
        type: UPDATE_SERVER_DNS_SETTINGS,
        payload: {
            secret,
            hostname,
            primaryDNS,
            secondaryDNS,
            searchDomains
        }
    };
}

export function completeUpdateServerDNSSettings(secret, hostname) {
    return {
        type: COMPLETE_UPDATE_SERVER_DNS_SETTINGS,
        payload: { secret, hostname }
    };
}

export function failUpdateServerDNSSettings(secret, hostname, error) {
    return {
        type: FAIL_UPDATE_SERVER_DNS_SETTINGS,
        payload: { secret, hostname, error }
    };
}

export function updateServerDetails(secret, hostname, newHostname, locationTag) {
    return {
        type: UPDATE_SERVER_DETAILS,
        payload: {
            secret,
            hostname,
            newHostname,
            locationTag
        }
    };
}

export function completeUpdateServerDetails(secret, hostname, newHostname) {
    return {
        type: COMPLETE_UPDATE_SERVER_DETAILS,
        payload: { secret, hostname, newHostname }
    };
}

export function failUpdateServerDetails(secret, hostname, error) {
    return {
        type: FAIL_UPDATE_SERVER_DETAILS,
        payload: { secret, hostname, error }
    };
}

export function updateServerTimeSettings(secret, hostname, timezone, ntpServer, epoch) {
    return {
        type: UPDATE_SERVER_TIME_SETTINGS,
        payload: { secret, hostname, timezone, epoch, ntpServer }
    };
}

export function completeUpdateServerTimeSettings(secret, hostname) {
    return {
        type: COMPLETE_UPDATE_SERVER_TIME_SETTINGS,
        payload: { secret, hostname }
    };
}

export function failUpdateServerTimeSettings(secret, hostname, error) {
    return {
        type: FAIL_UPDATE_SERVER_TIME_SETTINGS,
        payload: { secret, hostname, error }
    };

}

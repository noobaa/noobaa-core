import {
    UPDATE_SERVER_ADDRESS,
    COMPLETE_UPDATE_SERVER_ADDRESS,
    FAIL_UPDATE_SERVER_ADDRESS
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

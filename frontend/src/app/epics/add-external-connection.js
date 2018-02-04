/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { ADD_EXTERNAL_CONNECTION } from 'action-types';
import { completeAddExternalConnection, failAddExternalConnection } from 'action-creators';

function _getApiRequestParams(payload) {
    const { name, service, params } = payload;

    switch (service) {
        case 'AWS':
        case 'S3_COMPATIBLE': {
            return {
                name,
                endpoint_type: service,
                endpoint: params.endpoint,
                identity: params.accessKey,
                secret: params.secretKey
            };
        }

        case 'AZURE': {
            return {
                name,
                endpoint_type: service,
                endpoint: params.endpoint,
                identity: params.accountName,
                secret: params.accountKey
            };
        }

        case 'NET_STORAGE': {
            return {
                name,
                endpoint_type: 'NET_STORAGE',
                endpoint: `${params.storageGroup}-${params.hostname}`,
                identity: params.keyName,
                secret: params.authKey,
                cp_code: params.cpCode
            };
        }

        default: {
            throw new Error(`Invalid service: ${service}`);
        }
    }
}

export default function(action$, { api }) {
    return action$
        .ofType(ADD_EXTERNAL_CONNECTION)
        .flatMap(async action => {
            const { name } = action.payload;

            try {
                const requestParams = _getApiRequestParams(action.payload);
                await api.account.add_external_connection(requestParams);
                return completeAddExternalConnection(name);

            } catch (error) {
                return failAddExternalConnection(
                    name,
                    mapErrorObject(error)
                );
            }
        });
}

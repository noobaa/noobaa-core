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
                endpoint: params.awsEndpoint,
                identity: params.awsAccessKey,
                secret: params.awsSecretKey
            };
        }

        case 'AZURE': {
            return {
                name,
                endpoint_type: service,
                endpoint: params.azureEndpoint,
                identity: params.azureAccountName,
                secret: params.azureAccountKey
            };
        }

        case 'NET_STORAGE': {
            return {
                name,
                endpoint_type: service,
                endpoint: `${params.nsStorageGroup}-${params.nsHostname}`,
                identity: params.nsKeyName,
                secret: params.nsAuthKey,
                cp_code: params.nsCPCode
            };
        }
        case 'GOOGLE': {
            const { private_key_id } = JSON.parse(params.gcKeysJson);
            return {
                name,
                endpoint_type: service,
                endpoint: params.endpoint,
                identity: private_key_id,
                secret: params.gcKeysJson
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

/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { ADD_EXTERNAL_CONNECTION } from 'action-types';
import { completeAddExternalConnection, failAddExternalConnection } from 'action-creators';

function _getApiRequestParams(payload) {
    const { name, service, params } = payload;

    switch (service) {
        case 'AWS': {
            return {
                name,
                endpoint_type: service,
                endpoint: params.awsEndpoint,
                identity: params.awsAccessKey,
                secret: params.awsSecretKey
            };
        }

        case 'S3_V2_COMPATIBLE':{
            return {
                name,
                endpoint_type: 'S3_COMPATIBLE',
                endpoint: params.s3v2Endpoint,
                identity: params.s3v2AccessKey,
                secret: params.s3v2SecretKey,
                auth_method: 'AWS_V2'
            };
        }

        case 'S3_V4_COMPATIBLE': {
            return {
                name,
                endpoint_type: 'S3_COMPATIBLE',
                endpoint: params.s3v4Endpoint,
                identity: params.s3v4AccessKey,
                secret: params.s3v4SecretKey,
                auth_method: 'AWS_V4'
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
                endpoint: params.gcEndpoint,
                identity: private_key_id,
                secret: params.gcKeysJson
            };
        }
            
        case 'FLASHBLADE': {
            return {
                name,
                endpoint_type: 'FLASHBLADE',
                endpoint: params.fbEndpoint,
                identity: params.fbAccessKey,
                secret: params.fbSecretKey
            };
        }

        default: {
            throw new Error(`Invalid service: ${service}`);
        }
    }
}

export default function(action$, { api }) {
    return action$.pipe(
        ofType(ADD_EXTERNAL_CONNECTION),
        mergeMap(async action => {
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
        })
    );
}

/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_EXTERNAL_CONNECTION } from 'action-types';
import { completeUpdateExternalConnection, failUpdateExternalConnection } from 'action-creators';

function _getApiRequestParams(payload) {
    const { name, service, params } = payload;

    switch (service) {
        case 'AWS': {
            return {
                name,
                identity: params.awsAccessKey,
                secret: params.awsSecretKey
            };
        }

        case 'S3_V2_COMPATIBLE':{
            return {
                name,
                identity: params.s3v2AccessKey,
                secret: params.s3v2SecretKey
            };
        }

        case 'S3_V4_COMPATIBLE': {
            return {
                name,
                identity: params.s3v4AccessKey,
                secret: params.s3v4SecretKey
            };
        }

        case 'AZURE': {
            return {
                name,
                secret: params.azureAccountKey
            };
        }

        case 'GOOGLE': {
            const { private_key_id } = JSON.parse(params.gcKeysJson);
            return {
                name,
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
    return action$.pipe(
        ofType(UPDATE_EXTERNAL_CONNECTION),
        mergeMap(async action => {
            const { name } = action.payload;

            try {
                const requestParams = _getApiRequestParams(action.payload);
                await api.account.update_external_connection(requestParams);
                return completeUpdateExternalConnection(name);

            } catch (error) {
                return failUpdateExternalConnection(
                    name,
                    mapErrorObject(error)
                );
            }
        })
    );
}

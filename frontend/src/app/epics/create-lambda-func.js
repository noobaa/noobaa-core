/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { CREATE_LAMBDA_FUNC } from 'action-types';
import { completeCreateLambdaFunc, failCreateLambdaFunc } from 'action-creators';
import { Buffer }  from 'buffer';

export default function(action$, { api, bufferStore }) {
    return action$
        .ofType(CREATE_LAMBDA_FUNC)
        .flatMap(async action => {
            const {
                name,
                version,
                desc,
                runtime,
                handlerFile,
                handlerFunc,
                memorySize,
                timeout,
                codeBufferKey
            } = action.payload;

            try {
                const config = {
                    name,
                    version,
                    description: desc,
                    runtime,
                    handler: `${handlerFile}.${handlerFunc}`,
                    memory_size: memorySize,
                    timeout
                };

                const buffer = Buffer.from(new Uint8Array(bufferStore.get(codeBufferKey)));
                await api.func.create_func({
                    config,
                    code: {},
                    [api.RPC_BUFFERS]: { zipfile: buffer }
                });

                return completeCreateLambdaFunc(name);

            } catch (error) {
                return failCreateLambdaFunc(
                    name,
                    mapErrorObject(error)
                );
            }
        });
}

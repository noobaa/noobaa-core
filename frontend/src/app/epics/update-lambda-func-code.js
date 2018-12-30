/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { getFullHandlerName } from 'utils/func-utils';
import { UPDATE_LAMBDA_FUNC_CODE } from 'action-types';
import { Buffer } from 'buffer';
import {
    completeUpdateLambdaFuncCode,
    failUpdateLambdaFuncCode
} from 'action-creators';

export default function(action$, { api, bufferStore }) {
    return action$.pipe(
        ofType(UPDATE_LAMBDA_FUNC_CODE),
        mergeMap(async action => {
            const {
                name,
                version,
                handlerFile,
                handlerFunc,
                bufferHandle
            } = action.payload;

            try {
                const handler = getFullHandlerName(handlerFile, handlerFunc);
                const buffers = bufferHandle ?
                    {  zipfile: Buffer.from(bufferStore.get(bufferHandle)) } :
                    undefined;

                await api.func.update_func({
                    config: { name, version, handler },
                    code: bufferHandle ? {} : undefined,
                    [api.RPC_BUFFERS]: buffers
                });

                return completeUpdateLambdaFuncCode(name, version);

            } catch (error) {
                return failUpdateLambdaFuncCode(
                    name,
                    version,
                    mapErrorObject(error)
                );
            }
        })
    );
}

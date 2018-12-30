/* Copyright (C) 2016 NooBaa */

import { switchMap, map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { LOAD_LAMBDA_FUNC_CODE } from 'action-types';
import {
    completeLoadLambdaFuncCode,
    failLoadLambdaFuncCode
} from 'action-creators';

export default function(action$, { api, bufferStore }) {
    return action$.pipe(
        ofType(LOAD_LAMBDA_FUNC_CODE),
        switchMap(async action => {
            const { name, version } = action.payload;
            try {
                const reply = await api.func.read_func({
                    name,
                    version,
                    read_code: true
                });

                const { code_sha256: codeHash } = reply.config;
                const { zipfile } = reply[api.RPC_BUFFERS];
                return { name, version, codeHash, zipfile };

            } catch (e) {
                const error = mapErrorObject(e);
                return { name, version, error };
            }
        }),
        // Sepreating the following code into a secondary map operation allows us to store
        // the code buffer in the buffer store only for oprations that were no debounced
        // by the switch map operator.
        map(res => {
            const { name, version, codeHash, zipfile, error } = res;
            if (!error) {
                const bufferHandle = bufferStore.store(zipfile.buffer);
                return completeLoadLambdaFuncCode(name, version, codeHash, bufferHandle);

            } else {
                return failLoadLambdaFuncCode(name, version, error);
            }
        })
    );
}

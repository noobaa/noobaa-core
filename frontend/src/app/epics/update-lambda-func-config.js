/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_LAMBDA_FUNC_CONFIG } from 'action-types';
import {
    completeUpdateLambdaFuncConfig,
    failUpdateLambdaFuncConfig
} from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_LAMBDA_FUNC_CONFIG),
        mergeMap(async action => {
            const {
                name,
                version,
                description,
                runtime,
                memorySize,
                timeout
            } = action.payload;

            try {
                await api.func.update_func({
                    config: {
                        name,
                        version,
                        description,
                        runtime,
                        memory_size: memorySize,
                        timeout
                    }
                });
                return completeUpdateLambdaFuncConfig(name, version);

            } catch (error) {
                return failUpdateLambdaFuncConfig(
                    name,
                    version,
                    mapErrorObject(error)
                );
            }
        })
    );
}

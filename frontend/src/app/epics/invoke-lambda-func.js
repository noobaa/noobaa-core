/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { INVOKE_LAMBDA_FUNC } from 'action-types';
import {
    completeInvokeLambdaFunc,
    failInvokeLambdaFunc
} from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(INVOKE_LAMBDA_FUNC),
        mergeMap(async action => {
            const { name, version, event } = action.payload;

            try {
                const { result, error } = await api.func.invoke_func({
                    name,
                    version,
                    event
                });
                return completeInvokeLambdaFunc(name, version, error, result);

            } catch (error) {
                return failInvokeLambdaFunc(
                    name,
                    version,
                    mapErrorObject(error)
                );
            }
        })
    );
}

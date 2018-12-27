/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { DELETE_LAMBDA_FUNC } from 'action-types';
import {
    completeDeleteLambdaFunc,
    failDeleteLambdaFunc
} from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(DELETE_LAMBDA_FUNC),
        mergeMap(async action => {
            const { name, version } = action.payload;

            try {
                await await api.func.delete_func({ name, version });
                return completeDeleteLambdaFunc(name, version);

            } catch (error) {
                return failDeleteLambdaFunc(
                    name,
                    version,
                    mapErrorObject(error)
                );
            }
        })
    );
}

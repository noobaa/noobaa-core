/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_LAMBDA_FUNC_USAGE_HISTORY } from 'action-types';
import { completeFetchLambdaFuncUsageHistory, failFetchLambdaFuncUsageHistory } from 'action-creators';

export default function(action$, { api, getTime }) {
    return action$.pipe(
        ofType(FETCH_LAMBDA_FUNC_USAGE_HISTORY),
        mergeMap(async action => {
            const query = action.payload;

            try {
                const usageHistory = await api.func.read_func_stats({
                    name: query.name,
                    version: query.version,
                    since: getTime() - query.timespan,
                    step: query.step
                });

                return completeFetchLambdaFuncUsageHistory(query, usageHistory);

            } catch (error) {
                return failFetchLambdaFuncUsageHistory(
                    query,
                    mapErrorObject(error)
                );
            }
        })
    );
}

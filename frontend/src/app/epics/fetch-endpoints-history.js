/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { deepFreeze } from 'utils/core-utils';
import { FETCH_ENDPOINTS_HISTORY } from 'action-types';
import { completeFetchEndpointsHistory, failFetchEndpointsHistory } from 'action-creators';
import moment from 'moment';

const timespanMapping = deepFreeze({
    '24_HOURS': {
        unit: 'hour',
        span: 24,
        step: 1
    },
    '7_DAYS': {
        unit: 'day',
        span: 7,
        step: 24
    },
    '4_WEEKS': {
        unit: 'day',
        span: 28,
        step: 7 * 24
    }
});

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_ENDPOINTS_HISTORY),
        mergeMap(async action => {
            const query = action.payload;
            const { groups, timespan } = query;
            const { unit, span, step } = timespanMapping[timespan];

            const till = moment()
                .endOf(unit)
                .valueOf();

            const since = moment(till + 1)
                .subtract(span, unit)
                .valueOf();

            try {
                const history = await api.system.get_endpoints_history({
                    groups,
                    since,
                    till,
                    step
                });

                return completeFetchEndpointsHistory(query, history);

            } catch (error) {
                return failFetchEndpointsHistory(
                    query,
                    mapErrorObject(error)
                );
            }
        })
    );
}

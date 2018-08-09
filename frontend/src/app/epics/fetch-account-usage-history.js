/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_ACCOUNT_USAGE_HISTORY } from 'action-types';
import { completeFetchAccountUsageHistory, failFetchAccountUsageHistory } from 'action-creators';
import moment from 'moment';

const durationMeta = {
    DAY: {
        unit: 'hour',
        timespan: 24
    },
    WEEK: {
        unit: 'day',
        timespan: 7
    },
    MONTH: {
        unit: 'day',
        timespan: 28
    }
};

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_ACCOUNT_USAGE_HISTORY),
        mergeMap(async action => {
            const query = action.payload;
            const { unit, timespan } = durationMeta[query.duration];

            const till = moment()
                .endOf(unit)
                .valueOf();

            const since = moment(till + 1)
                .subtract(timespan, unit)
                .valueOf();

            try {
                const usageHistory = await api.account.get_account_usage({
                    accounts: query.accounts,
                    since,
                    till
                });

                return completeFetchAccountUsageHistory(query, usageHistory);

            } catch (error) {
                return failFetchAccountUsageHistory(
                    query,
                    mapErrorObject(error)
                );
            }
        })
    );
}

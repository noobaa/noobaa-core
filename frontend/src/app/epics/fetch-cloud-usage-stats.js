/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_CLOUD_USAGE_STATS } from 'action-types';
import { completeFetchCloudUsageStats, failFetchCloudUsageStats } from 'action-creators';
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
        ofType(FETCH_CLOUD_USAGE_STATS),
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
                const usage = await api.pool.get_cloud_services_stats({
                    start_date: since,
                    end_date: till
                });

                return completeFetchCloudUsageStats(query, usage);

            } catch (error) {
                return failFetchCloudUsageStats(
                    query,
                    mapErrorObject(error)
                );
            }
        })
    );
}

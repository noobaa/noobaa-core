/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_BUCKET_USAGE_HISTORY } from 'action-types';
import { completeFetchBucketUsageHistory, failFetchBucketUsageHistory } from 'action-creators';
import moment from 'moment';

const durationMeta = {
    DAY: {
        unit: 'hour',
        timespan: 24,
        resolution: 1
    },
    WEEK: {
        unit: 'day',
        timespan: 7,
        resolution: 1/4
    },
    MONTH: {
        unit: 'day',
        timespan: 28,
        resolution: 1
    }
};

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_BUCKET_USAGE_HISTORY),
        mergeMap(async action => {
            const query = action.payload;
            const { unit, timespan, resolution } = durationMeta[query.duration];
            const resolutionInHours = moment.duration(resolution, unit)
                .asHours();

            const till = moment()
                .endOf(unit)
                .valueOf();

            // Adding the reslution to the timesamp in oreder to fetch a base
            // sample to be used in the charts
            const since = moment(till + 1)
                .subtract(timespan + resolution, unit)
                .valueOf();

            try {
                const usageHistory = await api.bucket.get_bucket_throughput_usage({
                    buckets: query.buckets,
                    since,
                    till,
                    resolution: resolutionInHours
                });

                return completeFetchBucketUsageHistory(query, usageHistory);

            } catch (error) {
                return failFetchBucketUsageHistory(
                    query,
                    mapErrorObject(error)
                );
            }
        })
    );
}

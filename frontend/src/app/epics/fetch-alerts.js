/* Copyright (C) 2016 NooBaa */

import api from 'services/api';
import { FETCH_ALERTS } from 'action-types';
import { completeFetchAlerts, failFetchAlerts } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(FETCH_ALERTS)
        .flatMap(async action => {
            const { query, limit } = action.payload;

            try {
                const list = await api.events.read_alerts({ query, limit });
                return completeFetchAlerts(limit, list);

            } catch (error) {
                return failFetchAlerts(error);
            }
        });
}

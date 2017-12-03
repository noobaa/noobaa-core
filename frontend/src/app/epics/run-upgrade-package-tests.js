/* Copyright (C) 2016 NooBaa */

import { RUN_UPGRADE_PACKAGE_TESTS } from 'action-types';

export default function(action$, { api }) {
    return action$
        .ofType(RUN_UPGRADE_PACKAGE_TESTS)
        .flatMap(async () => {
            await api.cluster_internal.cluster_pre_upgrade({});
        });
}

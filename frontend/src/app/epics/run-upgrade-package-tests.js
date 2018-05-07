/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { RUN_UPGRADE_PACKAGE_TESTS } from 'action-types';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(RUN_UPGRADE_PACKAGE_TESTS),
        mergeMap(async () => {
            await api.upgrade.cluster_pre_upgrade({});
        })
    );
}

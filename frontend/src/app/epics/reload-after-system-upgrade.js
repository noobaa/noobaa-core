/* Copyright (C) 2016 NooBaa */

import { map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { COMPLETE_UPGRADE_SYSTEM } from 'action-types';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';

export default function(action$, { browser }) {
    return action$.pipe(
        ofType(COMPLETE_UPGRADE_SYSTEM),
        map(action => {
            const { system, version } = action.payload;
            const url = realizeUri(routes.system, { system }, { afterupgrade: version });
            browser.reload(url);
        })
    );
}

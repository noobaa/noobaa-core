/* Copyright (C) 2016 NooBaa */

import { map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { REQUEST_LOCATION } from 'action-types';
import * as routes from 'routes';

export default function(action$, { browser, router }) {
    return action$.pipe(
        ofType(REQUEST_LOCATION),
        map(action => {
            const { url, redirect } = action.payload;
            if (url.startsWith(routes.root)) {
                if (redirect) {
                    router.redirect(url);
                } else {
                    router.show(url);
                }
            } else {
                browser.navigateTo(url);
            }
        })
    );
}

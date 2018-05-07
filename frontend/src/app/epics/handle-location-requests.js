/* Copyright (C) 2016 NooBaa */

import { map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { REQUEST_LOCATION } from 'action-types';

export default function(action$, { router }) {
    return action$.pipe(
        ofType(REQUEST_LOCATION),
        map(action => {
            const { url, redirect } = action.payload;
            redirect ? router.redirect(url) : router.show(url);
        })
    );
}

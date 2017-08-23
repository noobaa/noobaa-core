/* Copyright (C) 2016 NooBaa */

import { REQUEST_LOCATION } from 'action-types';

export default function(action$, { router }) {
    return action$
        .ofType(REQUEST_LOCATION)
        .map(action => {
            const { url, redirect } = action.payload;
            redirect ? router.redirect(url) : router.show(url);
        });
}

/* Copyright (C) 2016 NooBaa */

import { get } from 'rx-extensions';
import { sessionTokenKey, previewContentKey } from 'config';

export default function (state$, { localStorage, sessionStorage })  {
    // Presist session token.
    state$
        .pipe(get('session'))
        .subscribe(session => {
            if (session === null) {
                localStorage.removeItem(sessionTokenKey);
                sessionStorage.removeItem(sessionTokenKey);
            }

            if (session) {
                const storage = session.persistent ? localStorage : sessionStorage;
                storage.setItem(sessionTokenKey, session.token);
            }
        });

    // Presist preview content flag.
    state$
        .pipe(get('env', 'previewContent'))
        .subscribe(previewContent => {
            previewContent ?
                localStorage.setItem(previewContentKey, true) :
                localStorage.removeItem(previewContentKey);
        });
}

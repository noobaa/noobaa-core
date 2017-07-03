/* Copyright (C) 2016 NooBaa */
import { sessionTokenKey, previewContentKey } from 'config';

export default function (state$, { localStorage, sessionStorage })  {
    // Presist session token.
    state$.get('session')
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
    state$.get('env', 'previewContent')
        .subscribe(previewContent => {
            previewContent ?
                localStorage.setItem(previewContentKey, true) :
                localStorage.removeItem(previewContentKey);
        });
}

/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import AppViewModel from 'app';
import { action$ } from 'state';
import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { noop } from 'utils';

const [, targetId] = global.name.split(':');

const messageToAction = {
    RECORD: message => ({
        type: 'ACCEPT_MESSAGE',
        payload: message.payload
    }),

    RECORDS: message => ({
        type: 'REPLACE_MESSAGES',
        payload: message.payload
    })
};

function getDebugStream(targetId) {
    return Observable.create(observer => {
        const channel = new BroadcastChannel(`debugChannel:${targetId}`);
        channel.onmessage = evt => observer.next(evt.data);
    });
}

async function importSvgIcons() {
    const res = await fetch('/fe/assets/icons.svg');
    const html  = await res.text();
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.firstChild.style.display = 'none';
    document.body.append(template.content);
}

async function main() {
    await importSvgIcons();

    action$.next({
        type: 'INITIALIZE',
        payload: { targetId }
    });

    // Setup the debug channle if we are attached to a managment console.
    if (targetId) {
        getDebugStream(targetId)
            .pipe(
                filter(message => message.origin === 'FE'),
                map(message => (messageToAction[message.type] || noop)(message)),
                filter(Boolean)
            )
            .subscribe(action$);
    }

    const app = new AppViewModel();
    ko.applyBindings(app);
}

main();


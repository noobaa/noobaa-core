/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { action$ } from 'state';
import AppViewModel from './app.js';

const [, targetId] = global.name.split(':');

function setupDebugChannel() {
    const channel = new BroadcastChannel(`debugChannel:${targetId}`);
    channel.onmessage = evt => action$.next({
        type: 'ACCEPT_MESSAGE',
        payload: evt.data
    });
    return channel;
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
    setupDebugChannel();

    action$.next({
        type: 'INITIALIZE',
        payload: { targetId }
    });

    const app = new AppViewModel();
    ko.applyBindings(app);
}

main();


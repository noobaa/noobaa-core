/* Copyright (C) 2016 NooBaa */

import template from './app.html';
import ko from 'knockout';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { requestLocation, openManagementConsoleErrorModal } from 'action-creators';
import * as routes from 'routes';
import { realizeUri } from 'utils/browser-utils';
import { getMany } from 'rx-extensions';

class AppViewModel extends Observer {
    constructor() {
        super();

        this.layout = ko.observable('empty');
        this.css = ko.observable();

        this.observe(
            state$.pipe(
                getMany(
                    'session',
                    'location',
                    'env',
                    'lastError'
                )
            ),
            this.onState
        );
    }

    onState([session, location = {}, env, lastError]) {
        if (lastError) {
            action$.next(openManagementConsoleErrorModal());
            return;
        }

        if (session && !location.route) {
            // Redirect to the system routes
            const url = realizeUri(routes.system, { system: session.system });
            action$.next(requestLocation(url, true));
            return;
        }

        const layout = (session && !session.passwordExpired) ?
            'main-layout' :
            'login-layout';

        this.layout(layout);
        this.css(`${layout} ${env.previewContent ? 'preview' : ''}`);
    }
}

export default {
    viewModel: AppViewModel,
    template: template
};

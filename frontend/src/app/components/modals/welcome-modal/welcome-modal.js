/* Copyright (C) 2016 NooBaa */

import template from './welcome-modal.html';
import Observer from 'observer';
import { realizeUri } from 'utils/browser-utils';
import { state$, action$ } from 'state';
import { requestLocation, closeModal } from 'action-creators';
import { get } from 'rx-extensions';

class WelcomeModalViewModel extends Observer {
    constructor() {
        super();

        this.systemUri = '';
        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );
    }

    onLocation(location) {
        const { route, params } = location;
        this.systemUri = realizeUri(route, params);
    }

    onStart() {
        action$.next(closeModal());
        action$.next(requestLocation(this.systemUri, true));
    }
}

export default {
    viewModel: WelcomeModalViewModel,
    template: template
};

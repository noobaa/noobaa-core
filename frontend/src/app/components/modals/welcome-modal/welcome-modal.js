/* Copyright (C) 2016 NooBaa */

import template from './welcome-modal.html';
import Observer from 'observer';
import { realizeUri } from 'utils/browser-utils';
import { state$, action$ } from 'state';
import { requestLocation } from 'action-creators';

class WelcomeModalViewModel extends Observer {
    constructor() {
        super();

        this.systemUri = '';
        this.observe(state$.get('location'), this.onLocation);
    }

    onLocation(location) {
        const { route, params } = location;
        this.systemUri = realizeUri(route, params);
    }

    onStart() {
        action$.onNext(requestLocation(this.systemUri, true));
    }
}

export default {
    viewModel: WelcomeModalViewModel,
    template: template
};

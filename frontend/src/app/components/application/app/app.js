/* Copyright (C) 2016 NooBaa */

import template from './app.html';
import ko from 'knockout';
import Observer from 'observer';
import { state$ } from 'state';

class AppViewModel extends Observer {
    constructor() {
        super();

        this.layout = ko.observable('empty');
        this.css = ko.observable();

        this.observe(
            state$.getMany('session', 'location', ['env']),
            this.onState
        );
    }

    onState([ session, location = {}, env ]) {
        if (session !== null && !location.route) {
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

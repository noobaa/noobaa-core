/* Copyright (C) 2016 NooBaa */

import template from './after-upgrade-modal.html';
import ko from 'knockout';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { closeModal, requestLocation } from 'action-creators';

class AfterUpgradeModalViewModel extends Observer {
    constructor() {
        super();

        this.version = ko.observable();

        this.observe(
            state$.getMany(
                ['system', 'version'],
                ['location', 'pathname']
            ),
            this.onState
        );
    }

    onState([version, pathname]) {
        this.version(version);
        this.pathname = pathname;
    }

    onDone() {
        action$.onNext(closeModal());
        action$.onNext(requestLocation(this.pathname));
    }
}

export default {
    viewModel: AfterUpgradeModalViewModel,
    template: template
};

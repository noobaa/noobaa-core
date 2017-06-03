/* Copyright (C) 2016 NooBaa */

import template from './welcome-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { sleep } from 'utils/promise-utils';

//const loadingDelay = 2000;

class WelcomeModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        //this.loading = ko.observable(true);
        //sleep(loadingDelay, false).then(this.loading);
    }

    start() {
        this.onClose();
    }
}

export default {
    viewModel: WelcomeModalViewModel,
    template: template
};

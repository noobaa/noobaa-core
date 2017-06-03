/* Copyright (C) 2016 NooBaa */

import template from './welcome-modal.html';
import BaseViewModel from 'components/base-view-model';

class WelcomeModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
    }

    start() {
        this.onClose();
    }
}

export default {
    viewModel: WelcomeModalViewModel,
    template: template
};

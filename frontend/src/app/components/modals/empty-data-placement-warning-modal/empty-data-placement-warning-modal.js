/* Copyright (C) 2016 NooBaa */

import template from './empty-data-placement-warning-modal.html';
import Observer from 'observer';
import { action$ } from 'state';
import { closeModal } from 'action-creators';

class EmptyDataPlacementWarningModalViewModel extends Observer {
    constructor({ action }) {
        super();

        this.action = action;
    }

    onBack() {
        action$.next(closeModal());
    }

    onContinue() {
        action$.next(this.action);
        action$.next(closeModal(Infinity));
    }
}

export default {
    viewModel: EmptyDataPlacementWarningModalViewModel,
    template: template
};

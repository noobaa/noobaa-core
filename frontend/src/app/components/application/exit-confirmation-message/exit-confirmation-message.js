/* Copyright (C) 2016 NooBaa */

import template from './exit-confirmation-message.html';
import Observer from 'observer';
import { state$ } from 'state';

class ExitConfirmationMessageViewModel extends Observer {
    constructor() {
        super();
        this.showMessage = false;

        this.observe(
            state$.get('objectUploads', 'stats', 'uploading'),
            this.onState
        );
    }

    onState(uploading) {
        this.showMessage = Boolean(uploading);
    }

    onBeforeUnload(_, evt) {
        if (this.showMessage) {
            return evt.returnValue ='Changes you made may not be saved.';
        }
    }
}

export default {
    viewModel: ExitConfirmationMessageViewModel,
    template: template
};

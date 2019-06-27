/* Copyright (C) 2016 NooBaa */

import template from './exit-confirmation-message.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';

class ExitConfirmationMessageViewModel extends ConnectableViewModel {
    showMessage = false;

    selectState(state) {
        const { objectUploads } = state;

        return [
            Boolean(objectUploads && objectUploads.stats.uploading)
        ];
    }

    mapStateToProps(uploadingObjects) {
        ko.assignToProps(this, {
            showMessage: uploadingObjects
        });
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

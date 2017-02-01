import template from './modal.html';
import BaseViewModel from 'components/base-view-model';
import { deepFreeze, noop } from 'utils/core-utils';
import ko from 'knockout';

const severityMapping = deepFreeze({
    success: {
        icon: 'notif-success',
        css: 'success'
    },
    warning: {
        icon: 'notif-warning',
        css: 'warning'
    },
    error: {
        icon: 'notif-error',
        css: 'error'
    }
});

class ModalViewModel extends BaseViewModel {
    constructor({
        title,
        severity,
        onClose = noop,
        allowBackdropClose = true,
        hideCloseButton = false,
        disableCloseButton = false
    }) {
        super();

        this.titleText = title;

        let meta = ko.pureComputed(
            () => severityMapping[ko.unwrap(severity)] || {}
        );

        this.titleCss = ko.pureComputed(
            () => meta().css
        );

        this.titleIcon = ko.pureComputed(
            () => meta().icon
        );

        this.allowBackdropClose = allowBackdropClose;
        this.hideCloseButton = hideCloseButton;
        this.disableCloseButton = disableCloseButton;
        this.onClose = onClose;
    }

    backdropClick() {
        if (ko.unwrap(this.allowBackdropClose)) {
            this.onClose();
        }
    }
}

export default {
    viewModel: ModalViewModel,
    template: template
};

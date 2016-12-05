import template from './modal.html';
import Disposable from 'disposable';
import { deepFreeze, noop } from 'utils/all';
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

class ModalViewModel extends Disposable {
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

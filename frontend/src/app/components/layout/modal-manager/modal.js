import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';

const severityMapping = deepFreeze({
    info: {
        icon: 'notif-info',
        css: 'info'
    },
    success: {
        icon: 'notif-success',
        css: 'success'
    },
    warning: {
        icon: 'problem',
        css: 'warning'
    },
    error: {
        icon: 'problem',
        css: 'error'
    }
});

export default class Modal {
    constructor(requestClose) {
        this.requestClose = requestClose;
        this.sizeCss = ko.observable();
        this.titleText = ko.observable();
        this.titleCss = ko.observable();
        this.titleIcon = ko.observable();
        this.isXButtonVisible = ko.observable();
        this.isXButtonDisabled = ko.observable();
        this.backdropClose = ko.observable();
        this.component = ko.observable();
    }

    update({ size, title, severity, closeButton, backdropClose, component }) {
        const { icon, css } = severityMapping[severity] || {};

        this.sizeCss(size ? `modal-${size}` : '');
        this.titleText(title);
        this.titleCss(css);
        this.titleIcon(icon);
        this.isXButtonVisible(closeButton !== 'hidden');
        this.isXButtonDisabled(closeButton === 'disabled');
        this.backdropClose(backdropClose);

        this.component({
            name: component.name,
            params: {
                ...component.params,
                onClose: this.requestClose
            }
        });
    }

    onX() {
        this.requestClose();
    }
}

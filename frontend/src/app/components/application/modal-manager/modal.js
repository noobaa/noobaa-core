/* Copyright (C) 2016 NooBaa */

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
    constructor({ onClose, onUpdateOptions }) {
        this.close = onClose;
        this.updateOptions = onUpdateOptions;

        this.css = ko.observable();
        this.titleText = ko.observable();
        this.titleCss = ko.observable();
        this.titleIcon = ko.observable();
        this.isXButtonVisible = ko.observable();
        this.isXButtonDisabled = ko.observable();
        this.backdropClose = ko.observable();
        this.component = ko.observable({});
    }

    onState({ size, title, severity, closeButton, backdropClose, component }) {
        const { icon, css } = severityMapping[severity] || {};

        this.css(`${size ? `modal-${size}` : ''} ${component.name}`);
        this.titleText(title);
        this.titleCss(css);
        this.titleIcon(icon);
        this.isXButtonVisible(closeButton !== 'hidden');
        this.isXButtonDisabled(closeButton === 'disabled');
        this.backdropClose(backdropClose);

        // Updating the component observable will cause a rerendering
        // of the modal content so we check that the component changed
        // before updating the observable.
        if (component.name !== this.component().name) {
            this.component({
                name: component.name,
                params: {
                    ...component.params,
                    onClose: this.close,
                    onUpdateOptions: this.updateOptions
                }
            });
        }
    }

    onX() {
        this.close();
    }
}

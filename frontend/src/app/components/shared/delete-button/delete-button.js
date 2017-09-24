/* Copyright (C) 2016 NooBaa */

import template from './delete-button.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { isFunction, noop } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';

class DeleteButtonViewModel extends BaseViewModel {
    constructor({
        id = randomString(),
        group = ko.observable(),
        onDelete,
        subject,
        tooltip,
        disabled = false,
    }) {
        super();

        this.id = id;
        this.onDelete = isFunction(onDelete) ? onDelete : noop;
        this.disabled = disabled;

        this.isActive = ko.pureComputed({
            read: () => group() === ko.unwrap(id),
            write: val => group(val ? ko.unwrap(id) : null)
        });

        this.tooltip = ko.pureComputed(
            () => {
                const text = tooltip == null ? `Delete ${ko.unwrap(subject)}` : ko.unwrap(tooltip);
                return this.isActive() ? undefined : { text, align: 'end' };
            }
        );

        this.icon = ko.pureComputed(
            () => (ko.unwrap(this.disabled) || !this.isActive()) ?
                'bin-closed' :
                'bin-opened'
        );

        this.question = ko.pureComputed(
            () => subject ? `Delete ${subject}?` : 'Delete ?'
        );
    }

    onActivate() {
        this.isActive(true);
    }

    onConfirm() {
        this.isActive(false);
        this.onDelete(ko.unwrap(this.id));
    }

    onCancel() {
        this.isActive(false);
    }
}

export default {
    viewModel: DeleteButtonViewModel,
    template: template
};

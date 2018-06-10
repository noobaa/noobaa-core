/* Copyright (C) 2016 NooBaa */

import template from './delete-button.html';
import ko from 'knockout';
import { isString, isFunction, noop } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';

class DeleteButtonViewModel {
    constructor({
        id = randomString(),
        group = ko.observable(),
        onDelete,
        subject,
        tooltip,
        disabled = false
    }) {
        this.id = id;
        this.onDelete = isFunction(onDelete) ? onDelete : noop;
        this.disabled = disabled;

        this.isActive = ko.pureComputed({
            read: () => group() === ko.unwrap(id),
            write: val => group(val ? ko.unwrap(id) : null)
        });

        this.tooltip = ko.pureComputed(
            () => {
                if (this.isActive()) return;
                const naked = ko.unwrap(tooltip);

                if (naked === null) {
                    return {
                        align: 'end',
                        text: `Delete ${ko.unwrap(subject)}`
                    };

                } else if (isString(naked)) {
                    return {
                        align: 'end',
                        text : naked
                    };

                } else {
                    return {
                        align: 'end',
                        ...naked
                    };
                }
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

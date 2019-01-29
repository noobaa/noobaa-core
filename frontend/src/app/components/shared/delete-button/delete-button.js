/* Copyright (C) 2016 NooBaa */

import template from './delete-button.html';
import ko from 'knockout';
import { isString, isFunction, noop } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';

class DeleteButtonViewModel {
    constructor({
        id = randomString(),
        text = 'Delete',
        active = ko.observable(),
        tooltip,
        disabled = false,
        onDelete,
        onToggle
    }) {
        this.id = id;
        this.onDelete = isFunction(onDelete) ? onDelete : noop;
        this.disabled = disabled;
        this.isActive = isFunction(onToggle) ?
            this.isActive = ko.pureComputed({
                read: active,
                write: val => onToggle(val ? ko.unwrap(id) : null)
            }) :
            active;

        this.tooltip = ko.pureComputed(() => {
            if (this.isActive()) return;
            const naked = ko.unwrap(tooltip);

            if (naked == null) {
                return {
                    align: 'end',
                    text: ko.unwrap(text)
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
        });

        this.icon = ko.pureComputed(() =>
            (ko.unwrap(this.disabled) || !this.isActive()) ?
                'bin-closed' :
                'bin-opened'
        );

        this.question = ko.pureComputed(() =>
            `${ko.unwrap(text)}?`
        );
    }

    onToggle() {
        this.isActive.toggle();
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

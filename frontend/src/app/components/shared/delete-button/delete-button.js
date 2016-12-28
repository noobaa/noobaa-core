import template from './delete-button.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { isFunction, noop } from 'utils/all';

class DeleteButtonViewModel extends BaseViewModel {
    constructor({
        subject,
        group = ko.observable(),
        onDelete,
        tooltip = 'delete',
        disabled = false
    }) {
        super();

        this.onDelete = isFunction(onDelete) ? onDelete : noop;
        this.disabled = disabled;

        this.isActive = ko.pureComputed({
            read: () => group() === this,
            write: val => group(val ? this : null)
        });

        this.tooltip = ko.pureComputed(
            () => this.isActive() ? undefined : { text: tooltip, align: 'end' }
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

    activate() {
        this.isActive(true);
    }

    confirm() {
        this.isActive(false);
        this.onDelete();
    }

    cancel() {
        this.isActive(false);
    }
}

export default {
    viewModel: DeleteButtonViewModel,
    template: template
};

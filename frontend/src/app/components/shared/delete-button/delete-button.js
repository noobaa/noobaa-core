import template from './delete-button.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { isFunction, noop } from 'utils';

const disabledIcon = 'bin-disabled';
const closedIcon = 'bin-closed';
const opendIcon = 'bin-opened';

class DeleteButtonViewModel extends Disposable {
    constructor({
        subject,
        group = ko.observable(),
        onDelete,
        tooltip = 'delete',
        disabled = false
    }) {
        super();

        this.onDelete = isFunction(onDelete) ? onDelete : noop;
        this.tooltip = tooltip;
        this.disabled = disabled;

        this.isActive = ko.pureComputed({
            read: () => group() === this,
            write: val => group(val ? this : null)
        });

        this.icon = ko.pureComputed(
            () => !ko.unwrap(this.disabled) ?
                (this.isActive() ? opendIcon : closedIcon) :
                disabledIcon
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

import template from './delete-button.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { isFunction, noop } from 'utils';

const disabledIcon = 'bin-disabled';
const closedIcon = 'bin-closed';
const opendIcon = 'bin-opened';

class DeleteButtonViewModel extends Disposable {
    constructor({
        group = ko.observable(),
        onDelete,
        toolTip = 'delete',
        disabled = false
    }) {
        super();

        this.onDelete = isFunction(onDelete) ? onDelete : noop;
        this.toolTip = toolTip;
        this.disabled = disabled;

        this.isSelected = ko.pureComputed({
            read: () => group() === this,
            write: val => {
                if (val) {
                    group(this);
                } else if (group() === this) {
                    group(null);
                }
            }
        });

        this.deleteIcon = ko.pureComputed(
            () => ko.unwrap(this.disabled) ?
                disabledIcon :
                (this.isSelected() ? opendIcon : closedIcon)
        );
    }

    select() {
        this.isSelected(true);
    }

    confirm() {
        this.isSelected(false);
        this.onDelete();
    }

    cancel() {
        this.isSelected(false);
    }
}

export default {
    viewModel: DeleteButtonViewModel,
    template: template
};

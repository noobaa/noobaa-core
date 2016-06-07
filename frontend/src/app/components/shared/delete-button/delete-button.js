import template from './delete-button.html';
import ko from 'knockout';
import { noop } from 'utils';

const disabledIcon = 'bin-disabled';
const closedIcon = 'bin-closed';
const opendIcon = 'bin-opened';

class DeleteButtonViewModel {
    constructor({
        group = ko.observable(),
        onDelete = noop,
        toolTip,
        disabled = false
    }) {
        this.onDelete = onDelete;
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
            () => {
                let icon = ko.unwrap(this.disabled) ?
                    disabledIcon :
                    (this.isSelected() ? opendIcon : closedIcon);

                return `/fe/assets/icons.svg#${icon}`;
            }
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

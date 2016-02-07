import template from './delete-button.html';
import ko from 'knockout';
import { noop } from 'utils';

const disabledIcon =  '/fe/assets/icons.svg#trash-disabled';
const closedIcon = '/fe/assets/icons.svg#trash-closed';
const opendIcon = '/fe/assets/icons.svg#trash-opened';

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
                    group(null)
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
        this.onDelete();
    }
    
    cancel() {
        this.isSelected(false);
    }
}

export default {
    viewModel: DeleteButtonViewModel,
    template: template
}
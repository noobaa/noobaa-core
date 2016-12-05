import template from './copy-to-clipboard-button.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils/all';

const copyMessage = 'Copy to Clipboard';
const copiedMessage = 'Copied';

class CopyToClipboardButtonViewModel extends Disposable {
    constructor({ value, disabled = false }) {
        super();
        this.value = value;
        this.disabled = disabled;
        this.tooltip = ko.observable(copyMessage);
    }

    copy() {
        copyTextToClipboard(ko.unwrap(this.value));
        this.tooltip(copiedMessage);
    }

    leave() {
        this.tooltip(copyMessage);
    }
}

export default {
    viewModel: CopyToClipboardButtonViewModel,
    template: template
};

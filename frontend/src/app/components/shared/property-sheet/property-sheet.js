import template from './property-sheet.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils';

class PropertySheetViewModel extends Disposable {
    constructor({ properties = [] }) {
        super();

        this.properties = properties;
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
    }
}

export default {
    viewModel: PropertySheetViewModel,
    template: template
};

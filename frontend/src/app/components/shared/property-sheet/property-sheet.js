import template from './property-sheet.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils';

class PropertySheetViewModel extends BaseViewModel {
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

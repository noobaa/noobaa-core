import template from './property-sheet.html';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils';

class PropertySheetViewModel {
    constructor({ properties = [] }) {
        this.properties = properties;
    }

    copyToClipboard(text) {
        copyTextToClipboard(text);
    }
}

export default {
    viewModel: PropertySheetViewModel,
    template: template,
}
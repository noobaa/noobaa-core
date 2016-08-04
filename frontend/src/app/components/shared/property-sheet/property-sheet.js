import template from './property-sheet.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils';

// const idelTooltip

class PropertySheetViewModel extends Disposable {
    constructor({ properties = [] }) {
        super();

        this.properties = properties;
        this.tooltip = ko.observable();
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
        // this
    }
}

export default {
    viewModel: PropertySheetViewModel,
    template: template
};

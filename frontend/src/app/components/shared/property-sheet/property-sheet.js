import template from './property-sheet.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils/all';

// const idelTooltip

class PropertySheetViewModel extends BaseViewModel {
    constructor({ properties = [] }) {
        super();

        this.properties = properties;
        this.tooltip = ko.observable();
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
    }
}

export default {
    viewModel: PropertySheetViewModel,
    template: template
};

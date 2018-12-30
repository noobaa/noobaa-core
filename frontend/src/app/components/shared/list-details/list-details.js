/* Copyright (C) 2016 NooBaa */

import template from './list-details.html';
import ko from 'knockout';
import { groupBy } from 'utils/core-utils';

const defaultRowTemplate = '{{$item}}';
const defaultDetailsTemplate = `
    <h2 class="pad heading3">
        {{$item}}
    </h2>
`;

class ListDetailsViewModel {
    constructor(params, templates) {
        const {
            row: rowTemplate = defaultRowTemplate,
            details: detailsTemplate = defaultDetailsTemplate
        } = templates;

        const {
            loading = false,
            rows = [],
            buttonLabel = 'Show Details',
            selected = ''
        } = params;


        this.loading = loading;
        this.rowTemplate = rowTemplate;
        this.detailsTemplate = detailsTemplate;
        this.rows = rows;
        this.buttonLabel = buttonLabel;
        this.selected = !ko.isWritableObservable(selected) ?
            ko.observable(ko.unwrap(selected)) :
            selected;
    }

    onToggleItem(item) {
        this.selected(item === this.selected() ? '' : item);
    }
}

function viewModelFactory(params, info) {
    const templateElms = info.templateNodes
        .filter(node =>
            node.nodeType === Node.ELEMENT_NODE &&
            node.tagName.toUpperCase() === 'TEMPLATE'
        );

    const templates = groupBy(
        templateElms,
        elm => elm.getAttribute('name'),
        elm => elm.innerHTML
    );

    return new ListDetailsViewModel(params, templates);
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};

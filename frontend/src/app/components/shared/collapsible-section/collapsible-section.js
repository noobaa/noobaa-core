/* Copyright (C) 2016 NooBaa */

import template from './collapsible-section.html';
import BaseViewModel from 'components/base-view-model';

class CollapsibleSectionViewModel extends BaseViewModel {
    constructor(params, collapsedTemplate, expandedTemplate) {
        super();

        let { title, collapsed } = params;

        this.title = title;
        this.intent = collapsed;
        this.collapsedTemplate = collapsedTemplate;
        this.expandedTemplate = expandedTemplate;
    }
}

function viewModelFactory(params, info) {
    const collapsedTemplate = info.templateNodes.find(
        template => template.dataset && template.dataset.name === 'collapsed'
    );

    const expandedTemplate = info.templateNodes.find(
        template => template.dataset && template.dataset.name === 'expanded'
    );


    return new CollapsibleSectionViewModel(
        params,
        collapsedTemplate ? [collapsedTemplate] : [],
        expandedTemplate ? [expandedTemplate] : []
    );
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};

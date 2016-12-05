import template from './collapsible-section.html';
import Disposable from 'disposable';
import ko from 'knockout';
//import { uiState } from 'model';
//import { navigateTo } from 'actions';

class CollapsibleSectionViewModel extends Disposable{
    constructor(params, collapsedTemplate, expandedTemplate) {
        super();

        let { title, collapsed } = params;

        this.title = title;
        this.intent = collapsed;
        this.result = ko.observable(this.intent());
        this.collapsedTemplate = collapsedTemplate;
        this.expandedTemplate = expandedTemplate;
    }

    onTransitionEnd() {
        this.result(this.intent());
    }
}

function viewModelFactory(params, info) {
    const collapsedTemplate = info.templateNodes.find(
        template => template.dataset && template.dataset.name === 'collapsed'
    );

    const expandedTemplate = info.templateNodes.find(
        template => template.dataset && template.dataset.name === 'expanded'
    );


    return new CollapsibleSectionViewModel(params, collapsedTemplate, expandedTemplate);
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};

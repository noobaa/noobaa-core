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
    let templates = info.templateNodes
        .filter(
            ({ nodeType }) => nodeType === 1
        )
        .reduce(
            (templates, template) => {
                let name = template.getAttribute('class');
                let html = template.innerHTML;
                templates[name] = html;
                return templates;
            },
            {}
        );

    return new CollapsibleSectionViewModel(params, templates.collapsed, templates.expanded);
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};

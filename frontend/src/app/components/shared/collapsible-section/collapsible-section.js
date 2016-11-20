import template from './collapsible-section.html';
import Disposable from 'disposable';
import ko from 'knockout';
//import { uiState } from 'model';
//import { navigateTo } from 'actions';

class CollapsibleSectionViewModel extends Disposable{
    constructor(params, templates) {
        super();

        let { title, collapsed } = params;

        this.title = title;
        this.intent = collapsed;
        this.result = ko.observable(this.intent());
        this.templates = templates;
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
                let name = template.getAttribute('name');
                let html = template.innerHTML;
                templates[name] = html;
                return templates;
            },
            {}
        );

    return new CollapsibleSectionViewModel(params, templates);
}

export default {
    viewModel: { createViewModel: viewModelFactory },
    template: template
};

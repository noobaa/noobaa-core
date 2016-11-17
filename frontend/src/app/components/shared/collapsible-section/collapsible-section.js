import template from './collapsible-section.html';
import Disposable from 'disposable';
import ko from 'knockout';
//import { uiState } from 'model';
//import { navigateTo } from 'actions';

class CollapsibleSectionViewModel extends Disposable{
    constructor({ title, collapsed }) {
        super();

        this.title = title;

        this.intent = collapsed;
        this.result = ko.observable(this.intent());

    }

    onTransitionEnd() {
        this.result(this.intent());
    }
}

export default {
    viewModel: CollapsibleSectionViewModel,
    template: template
};

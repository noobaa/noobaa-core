import template from './drawer.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { uiState } from 'model';
import { closeDrawer } from 'actions';

class DrawerViewModel extends BaseViewModel {
    constructor() {
        super();

        // Hold the content of the drawer state until transition (slide) is over.
        this.holdContent = ko.observable();

        // Decide if we render the content.
        this.content = ko.pureComputed(
            () => uiState().drawer || this.holdContent()
        );

        // Adding rate limit to create an async behaviour in order to apply
        // css transitions.
        this.isVisible = ko.pureComputed(
            () => uiState().drawer
        ).extend({
            rateLimit: 1
        });
    }

    update() {
        this.holdContent(uiState().drawer);
    }

    close() {
        closeDrawer();
    }
}

export default {
    viewModel: DrawerViewModel,
    template: template
};

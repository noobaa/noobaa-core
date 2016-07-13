import template from './drawer.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { uiState } from 'model';
import { closeDrawer } from 'actions';

class DrawerViewModel extends Disposable {
    constructor() {
        super();

        this.isOpen = ko.pureComputed(
            () => uiState().drawer
        );

        // Hold the content of the drawer state until transition (slide) is over.
        this.holdContent = ko.observable();

        // Decide if we render the content.
        this.isContentVisible = ko.pureComputed(
            () => this.isOpen() || this.holdContent()
        );

        // Adding rate limit to create an async behaviour in order to apply
        // css transitions.
        this.isVisible = ko.pureComputed(
            () => this.isOpen()
        ).extend({
            rateLimit: 1
        });
    }

    update() {
        this.holdContent(this.isOpen());
    }

    close() {
        closeDrawer();
    }
}

export default {
    viewModel: DrawerViewModel,
    template: template
};

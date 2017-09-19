/* Copyright (C) 2016 NooBaa */

import template from './help-viewer.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import externalDataStore from '../../../services/external-data-store';
import {
    closeHelpViewer,
    resizeHelpViewer,
    selectHelpSlide
} from 'action-creators';

const helpMetadata = 'helpMetadata';

class HelpViewerViewModel extends Observer {
    constructor() {
        super();

        this.visible = ko.observable();
        this.resizeIcon = ko.observable();
        this.title = ko.observable();
        this.topic = ko.observable();
        this.slide = ko.observable();
        this.minimized = ko.observable();
        this.isShowDone = ko.observable();
        this.isShowPrevious = ko.observable();

        this.onPrev = this.onPrev.bind(this);
        this.onNext = this.onNext.bind(this);

        this.observe(state$.get('interactiveHelp'), this.onInteractiveHelp);
    }

    onInteractiveHelp(interactiveHelp) {
        if(!interactiveHelp.selected) {
            this.visible(false);
            this.topic(null);
            this.title('');
        } else {
            const { name, minimized, slide } = interactiveHelp.selected;
            const { title, ...topic } = externalDataStore.get(helpMetadata).topics[name];
            const isLastSlide = (topic.kind === 'SLIDES') && (topic.slides.length === slide + 1);

            this.title(title);
            this.topic(topic);
            this.slide(slide);
            this.minimized(minimized);
            this.resizeIcon(minimized ? 'maximize' : 'minimize');
            this.isShowDone(isLastSlide);
            this.isShowPrevious((topic.kind === 'SLIDES') && (slide !== 0));
            this.visible(true);
        }
    }

    onClose() {
        action$.onNext(closeHelpViewer());
    }

    onResize() {
        action$.onNext(resizeHelpViewer());
    }

    onPrev() {
        action$.onNext(selectHelpSlide(this.slide() - 1));
    }

    onNext() {
        action$.onNext(selectHelpSlide(this.slide() + 1));
    }
}

export default {
    viewModel: HelpViewerViewModel,
    template: template
};

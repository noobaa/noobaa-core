/* Copyright (C) 2016 NooBaa */

import template from './button-group.html';
import ko from 'knockout';

class ButtonGroupViewModel {
    mainBtn = null;
    otherBtns = [];
    opened = ko.observable(false);

    constructor([mainBtn, ...otherBtns]) {
        this.mainBtn = mainBtn;
        this.otherBtns = otherBtns;
    }

    onToggle() {
        this.opened(!this.opened());
    }

    onClose() {
        this.opened(false);

    }
}

function viewModelFactory(_, info) {
    const buttons = info.templateNodes
        .filter(node => node.nodeType === Node.ELEMENT_NODE)
        .map(button => {
            button.classList.add('btn');
            return button;
        });

    return new ButtonGroupViewModel(buttons);
}

export default {
    viewModel: {  createViewModel: viewModelFactory },
    template: template
};

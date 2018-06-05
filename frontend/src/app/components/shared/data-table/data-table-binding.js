/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

const event = 'resize';

function setHeadPadding(table) {
    const head = table.querySelector('thead');
    const body = table.querySelector('tbody');

    if (body.clientWidth > 0) {
        const diff = head.clientWidth - body.clientWidth;
        head.style.paddingRight = `${diff}px`;
    } else {
        head.style.paddingRight = 'auto';
    }
}

ko.bindingHandlers.datatable = {
    init(element) {
        const onResize = () => setHeadPadding(element);

        global.addEventListener(event, onResize, false);
        ko.utils.domNodeDisposal.addDisposeCallback(
            element,
            () => global.removeEventListener(event, onResize, false)
        );
    },

    update(element, valueAccessor) {
        ko.unwrap(valueAccessor());
        ko.tasks.schedule(() => setHeadPadding(element));
    }
};

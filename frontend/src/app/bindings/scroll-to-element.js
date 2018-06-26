/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

function scrollToElement(element, valueAccessor) {
    const value = ko.unwrap(valueAccessor());
    if (value) {
        element.scrollIntoView();
    }
}

export default {
    init: scrollToElement,
    update: scrollToElement
};

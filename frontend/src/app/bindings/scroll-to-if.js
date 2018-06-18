/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { sleep } from 'utils/promise-utils';

function scroll(element, valueAccessor) {
    const value = ko.utils.unwrapObservable(valueAccessor());
    if (value) {
        const scrollParent = element.closest('.scroll');
        const nodes = [...scrollParent.children];
        const node = nodes.find((node) => node.contains(element));

        sleep(1000, false).then(() => scrollParent.scrollTop = node.offsetTop);
    }
}

export default {
    init: scroll,
    update: scroll
};

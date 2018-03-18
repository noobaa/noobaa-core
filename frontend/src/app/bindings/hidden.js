/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        return ko.bindingHandlers.visible.update(
            element,
            () => !ko.unwrap(valueAccessor()),
            allBindings,
            viewModel,
            bindingContext
        );
    }
};

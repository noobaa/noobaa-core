/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default {
    allowOnVirtualElements: true,

    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        // Make a modified binding context, with extra properties, and apply it to descendant elements
        var innerContext = bindingContext.extend(valueAccessor);
        ko.applyBindingsToDescendants(innerContext, element);

        return { controlsDescendantBindings: true };
    }
};

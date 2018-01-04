/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

const original = ko.bindingHandlers.value;

export default {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        const value = valueAccessor();

        // Parse numbers (form input[type=number] elements) before setting the target observable.
        if (ko.isWritableObservable(value) &&
            element.tagName.toUpperCase() === 'INPUT' &&
            element.type === 'number') {

            const castingComputed = ko.pureComputed({
                read: value,
                write: val => value(Number(val))
            });

            valueAccessor = () => castingComputed;
        }

        return original.init(element, valueAccessor, allBindings, viewModel, bindingContext);
    }
};

/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { hasOwn } from 'utils/core-utils';
import { domFromHtml } from 'utils/browser-utils';

const original = ko.bindingHandlers.template;

export default {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let value = valueAccessor();
        if (hasOwn(value, 'html')) {
            value.nodes = domFromHtml(
                ko.unwrap(value.html)
            );
        }

        if (hasOwn(value, 'let')) {
            bindingContext = bindingContext.extend(value['let']);
        }

        return original.init(element, () => value, allBindings, viewModel, bindingContext);
    },

    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let value = valueAccessor();
        if (hasOwn(value, 'html')) {
            value.nodes = domFromHtml(
                ko.unwrap(value.html)
            );
        }

        if (hasOwn(value, 'let')) {
            bindingContext = bindingContext.extend(value['let']);
        }

        return original.update(element, () => value, allBindings, viewModel, bindingContext);
    }
};

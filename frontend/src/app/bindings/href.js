/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import * as routes from 'routes';
import { routeContext } from 'model';
import { realizeUri } from 'utils/browser-utils';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        let value = ko.deepUnwrap(valueAccessor());
        if (value) {
            let { route, params, query } = value;
            let href = realizeUri(
                routes[route] || '',
                Object.assign({}, routeContext().params, params),
                query
            );

            return ko.bindingHandlers.attr.update(
                element,
                () => href ? { href } : {},
                allBindings,
                viewModel,
                bindingContext
            );
        }
    }
};

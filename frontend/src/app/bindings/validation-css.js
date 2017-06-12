/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        const { isValid, isInvalid, isValidating, wasTouched } = valueAccessor();

        const css = ko.pureComputed(
            () => ({
                valid: isValid(),
                validating: isValidating(),
                invalid: wasTouched() && isInvalid()
            })
        );

        return ko.bindingHandlers.css.update(element, () => css ,allBindings, viewModel, bindingContext);
    }
};

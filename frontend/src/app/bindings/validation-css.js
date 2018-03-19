/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';

export default {
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        const { isValid, isInvalid, isValidating, wasTouched, warning } = valueAccessor();

        const css = ko.pureComputed(
            () => ({
                valid: isValid(),
                validating: isValidating(),
                invalid: wasTouched() && isInvalid(),
                warned: wasTouched() && Boolean(warning())
            })
        );

        return ko.bindingHandlers.css.update(element, () => css ,allBindings, viewModel, bindingContext);
    }
};

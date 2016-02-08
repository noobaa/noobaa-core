import { isFunction, isDefined } from 'utils';

export default function register(ko) {
    Object.assign(ko.validation.rules, {
        // Extend required validator to support expressions.
        required: {
            validator(value, condition) {
                let isRequired = !!(isFunction(condition) ? condition() : condition);

                return isRequired ? 
                    isDefined(value) && value !== null && value.length !== 0 :
                    true;
            },

            message: ko.validation.rules.required.message
        },

        isDNSName: {
            validator(value) {
                return /^(?![0-9]+$)(?!-)[a-zA-Z0-9-]{1,63}(?!-)$/.test(value);
            },

            message: 'Please provide a valid DNS name'
        }
    });

    ko.validation.registerExtenders();
}
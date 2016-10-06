import ko from 'knockout';
import { isObject } from 'utils';

ko.subscribable.fn.is = function(value) {
    return ko.pureComputed(
        () => ko.unwrap(this()) === value
    );
};

ko.subscribable.fn.toggle = function() {
    this(!this());
    return this;
};

ko.subscribable.fn.assign = function(data) {
    this(Object.assign(this(), ko.unwrap(data)));
    return this;
};

ko.subscribable.fn.once = function(callback, ctx, event) {
    let sub = this.subscribe(
        val => {
            sub.dispose();
            callback(val);
        },
        ctx,
        event
    );
    return sub;
};

ko.observableWithDefault = function(valueAccessor) {
    let storage = ko.observable();
    return ko.pureComputed({
        read: () => typeof storage() !== 'undefined' ? storage() : ko.unwrap(valueAccessor()),
        write: storage
    });
};

ko.deepUnwrap = function(value) {
    let uw = ko.unwrap(value);
    if (isObject(uw)) {
        return Object.keys(uw).reduce(
            (res, key) => {
                res[key] = ko.deepUnwrap(uw[key]);
                return res;
            },
            uw instanceof Array ? [] : {}
        );
    } else {
        return uw;
    }
};

// ko.validation specific extentions:
// ----------------------------------
if (ko.validation) {
    let kv = ko.validation;

    const getRuleValidationState = function(observable, appliedRule) {
        let {
            rule = 'inline',
            params,
            validator = kv.rules[rule].validator,
            message = kv.rules[rule].message
        } = appliedRule;

        return {
            rule: rule,
            isValid: validator(observable(), params),
            message:  kv.formatMessage(message, params, observable)
        };
    };

    ko.validation.fullValidationState = function(observable) {
        return ko.pureComputed(
            () => {
                let rules = observable.rules;

                if (!rules) {
                    return [];
                }

                return rules().map(
                    rule => getRuleValidationState(observable, rule)
                );
            }
        );
    };
}

window.ko = ko;


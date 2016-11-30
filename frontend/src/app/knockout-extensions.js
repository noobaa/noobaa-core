import ko from 'knockout';
import { isObject, isUndefined, deepFreeze } from 'utils/all';

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
    let changes = ko.unwrap(data);
    let value = isUndefined(this()) ? changes : Object.assign(this(), changes);
    this(value);
    return this;
};

ko.subscribable.fn.once = function(callback, ctx, event) {
    const sub = this.subscribe(
        val => {
            sub.dispose();
            callback(val);
        },
        ctx,
        event
    );
    return sub;
};

ko.subscribable.fn.debug = function(prefix) {
    prefix ? console.debug(prefix, this()) : console.debug(this());
    return this.subscribe(
        val => prefix ? console.debug(prefix, val) : console.debug(val)
    );
};

ko.observableWithDefault = function(valueAccessor) {
    let storage = ko.observable();
    return ko.pureComputed({
        read: () => typeof storage() !== 'undefined' ? storage() : ko.unwrap(valueAccessor()),
        write: storage
    });
};

ko.deepUnwrap = function(value) {
    const naked = ko.unwrap(value);
    if (isObject(naked)) {
        return Object.keys(naked).reduce(
            (res, key) => {
                res[key] = ko.deepUnwrap(naked[key]);
                return res;
            },
            naked instanceof Array ? [] : {}
        );
    } else {
        return naked;
    }
};

ko.touched = function(root) {
    let initialized = false;
    const trigger = ko.observable();
    const obs = ko.pureComputed(
        () => {
            trigger();

            if (!initialized) {
                ko.deepUnwrap(root);
                initialized = true;
                return false;
            }

            return true;
        }
    );

    obs.reset = function() {
        initialized = false;
        trigger.valueHasMutated();
    };

    // Force observable to calculate inital value.
    // (pureComputed does not calculate value until first subscription )
    obs();

    return obs;
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

    const validationGroupExtensions = deepFreeze({
        validatingCount() {
            return this.filter( obj => obj.isValidating() ).length;
        }
    });

    const kvGroup = ko.validation.group;
    ko.validation.group = function(obj, options) {
        return Object.assign(
            kvGroup(obj, options),
            validationGroupExtensions
        );
    };

    // ko.validation.isValidating = function (validationGroup) {
    //     return Boolean(
    //         validationGroup.filter( obs => obs.isValidating() ).length
    //     );
    // }
}

window.ko = ko;


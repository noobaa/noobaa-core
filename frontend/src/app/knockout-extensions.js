import ko from 'knockout';
import { isObject } from 'utils';

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

ko.observableWithDefault = function(valueAccessor) {
    let storage = ko.observable();
    return ko.pureComputed({
        read: () => typeof storage() !== 'undefined' ? storage() : ko.unwrap(valueAccessor()),
        write: storage
    });
};


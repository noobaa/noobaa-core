import ko from 'knockout';

ko.subscribable.fn.is = function(value) {
    return ko.pureComputed(
        () => ko.unwrap(this()) === value
    );
};

ko.subscribable.fn.toggle = function () {
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


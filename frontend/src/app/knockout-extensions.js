/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { isObject, isUndefined, deepFreeze, isNumber, throttle } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';

// -----------------------------------------
// Knockout object extnesions
// -----------------------------------------
ko.observableWithDefault = function(valueAccessor) {
    const storage = ko.observable();
    return ko.pureComputed({
        read: () => isUndefined(storage()) ? ko.unwrap(valueAccessor()) : storage(),
        write: storage
    });
};

ko.deepUnwrap = function(value) {
    const naked = ko.unwrap(value);
    if (isObject(naked)) {
        let needUnwrap = false;
        const res = Object.entries(naked).reduce(
            (res, [key, val]) => {
                res[key] = ko.deepUnwrap(val);
                needUnwrap = res[key] !== val || needUnwrap;
                return res;
            },
            Array.isArray(naked) ? [] : {}
        );
        return needUnwrap ? res : naked;
    } else {
        return naked;
    }
};

ko.touched = function(root) {
    let initialized = false;
    const trigger = ko.observable(false);
    return ko.pureComputed({
        read: () => {
            trigger();

            if (!initialized) {
                ko.deepUnwrap(root);
                initialized = true;
                return false;
            }

            return true;
        },
        write: () => {
            initialized = false;
            trigger.toggle();
        }
    });
};

ko.renderToString = function(template, data) {
    const doc = new DOMParser().parseFromString(template, 'text/html');
    ko.applyBindings(data, doc.body);
    const htmlString = doc.body.innerHTML.toString();
    ko.cleanNode(doc);
    return htmlString;
};

ko.group = function(...observables) {
    return ko.pureComputed(
        () => observables.map(obs => ko.unwrap(obs))
    );
};

ko.pc = function(read, write, owner) {
    return ko.pureComputed({ read, write, owner });
};


// -----------------------------------------
// Knockout subscribable extnesions
// -----------------------------------------
ko.subscribable.fn.toggle = function() {
    this(!this());
    return this;
};

ko.subscribable.fn.assign = function(data) {
    const changes = ko.unwrap(data);
    const value = isUndefined(this()) ? changes : Object.assign(this(), changes);
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

ko.subscribable.fn.eq = function(value) {
    return ko.pureComputed(() => this() === value);
};

ko.subscribable.fn.oneOf = function(...values) {
    return ko.pureComputed(() => values.includes(this()));

};

ko.subscribable.fn.when = function(condition = Boolean) {
    const val = this.peek();
    if (condition(val)) {
        return Promise.resolve(val);
    } else {
        return new Promise(resolve => {
            const sub = this.subscribe(val => {
                if (condition(val)) {
                    sub.dispose();
                    resolve(val);
                }
            });
        });
    }
};

ko.subscribable.fn.throttle = function(duration = 1, owner) {
    return ko.pureComputed({
        read: this,
        write: throttle(val => this(val), duration),
        owner: owner
    });
};

ko.observable.fn.map = function(mapOp) {
    let prevItems = [];
    const projected = ko.pureComputed(
        () => {
            const current = this();
            if (Array.isArray(current)) {
                const prev = prevItems;
                return (prevItems = current).map(
                    (item, i) => (item === prev[i]) ? projected.peek()[i] : mapOp(item)
                );

            } else {
                return prevItems = [];
            }
        }
    );
    return projected;
};

ko.observableArray.fn.get = function(i) {
    return this()[i];
};

ko.observableArray.fn.peek = function(i) {
    if (isNumber(i)) {
        return ko.observable.fn.peek.call(this)[i];
    } else {
        return ko.observable.fn.peek.call(this);
    }

};

// -----------------------------------------
// Knockout validation specific extentions
// -----------------------------------------
const kv = ko.validation;
const kvGroup = kv.group;

function getRuleValidationState(observable, appliedRule) {
    const {
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
}

function validatingCount() {
    return this.filter(obj => obj.isValidating()).length;
}

ko.validation.fullValidationState = function(observable) {
    return ko.pureComputed(
        () => {
            const rules = observable.rules;
            if (!rules) {
                return [];
            }

            return rules().map(
                rule => getRuleValidationState(observable, rule)
            );
        }
    );
};

ko.validation.group = function(obj, options) {
    return Object.assign(
        kvGroup(obj, options),
        { validatingCount }
    );
};

// -----------------------------------------
// Binding syntax extentions
// -----------------------------------------
const bindPrefix = 'ko.';
const magicBindingName = '@';
const magicBindings = new Map();
const bindingHandlers = new Map();
const origGetBindingHandler = ko.getBindingHandler;
const copyrightsIdentifiers = deepFreeze([
    'copyright',
    'noobaa'
]);
const preprocessByNodeType = deepFreeze({
    [Node.ELEMENT_NODE]: preprocessElement,
    [Node.TEXT_NODE]: preprocessTextNode,
    [Node.COMMENT_NODE]: preprocessComment
});


function preprocessElement(node) {
    const { attributes, dataset } = node;

    const bindings = Array.from(attributes)
        .filter(({ name }) => name.startsWith(bindPrefix))
        .map(({ name, value }) => [ name.substr(bindPrefix.length), value ]);


    if (bindings.length > 0) {
        const key = randomString();
        magicBindings.set(key, bindings);

        if (dataset.bind) {
            dataset.bind += `,${magicBindingName}:${key}`;
        } else {
            dataset.bind = `${magicBindingName}:${key}`;
        }
    }
}

function preprocessTextNode(node) {
    node.normalize();
    const before = node.nodeValue;
    const after = before.replace(/\{\{[\s\S]*?\}\}/g, match => {
        const expr = match.substr(2, match.length - 4);
        return `'+ko.unwrap(${expr})+'`;
    });

    if (after !== before) {
        // Replace tabs and newlines with spaces because knokcout virtual elements
        // has problem in parseing multiline expressions.
        const expr = after.replace(/\s+/g, () => ' ');

        const parent = node.parentNode;
        const nodes = [
            document.createComment(` ko text: '${expr}' `),
            document.createComment(' /ko ')
        ];
        parent.insertBefore(nodes[0], node);
        parent.replaceChild(nodes[1], node);

        return nodes;
    }
}

function preprocessComment(comment) {
    const text = comment.nodeValue.toLowerCase();
    if (copyrightsIdentifiers.every(identifier => text.includes(identifier))) {
        comment.parentNode.removeChild(comment);
        return [];
    }
}

function subclassBindingHandler(key, handler) {
    return Object.assign(Object.create(handler), {
        init: handler.init && (
            (a, b, c, d, e) => handler.init(a, () => ({ [key]: b() }), c, d, e)
        ),
        update: handler.update && (
            (a, b, c, d, e) => handler.update(a, () => ({ [key]: b() }), c, d, e)
        )
    });
}

ko.bindingProvider.instance.preprocessNode = function(node) {
    const preprocess = preprocessByNodeType[node.nodeType];
    return preprocess && preprocess(node);
};

ko.getBindingHandler = function(name) {
    let handler = bindingHandlers.get(name);
    if (handler) return handler;

    const [ binding, key ] = name.split('.');
    handler = origGetBindingHandler(binding);
    handler = key ? subclassBindingHandler(key, handler) : handler;
    bindingHandlers.set(name, handler);

    return handler;
};

ko.bindingHandlers[magicBindingName] = {
    preprocess(key, _, addBinding) {
        for (const [name, value] of magicBindings.get(key)) {
            addBinding(name, value);
        }
        magicBindings.delete(key);
    }
};

// Add lowercased copies of build-in bindings (to support the ko.<binding> attribute notation).
Object.entries(ko.bindingHandlers)
    .forEach(([name, binding]) => {
        const lcName = name.toLowerCase();
        if (lcName !== name) ko.bindingHandlers[lcName] = binding;
    });


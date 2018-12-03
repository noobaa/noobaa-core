/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { randomString } from 'utils/string-utils';
import {
    isObject,
    isUndefined,
    isFunction,
    isNumber,
    deepFreeze,
    throttle
} from 'utils/core-utils';

// -----------------------------------------
// Knockout object extnesions
// -----------------------------------------

// @DEPRECATED
ko.observableWithDefault = function(valueAccessor) {
    const storage = ko.observable();
    return ko.pureComputed({
        read: () => isUndefined(storage()) ? ko.unwrap(valueAccessor()) : storage(),
        write: storage
    });
};

// @DEPRECATED
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

// @DEPRECATED
ko.group = function(...observables) {
    return ko.pureComputed(
        () => observables.map(obs => ko.unwrap(obs))
    );
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

ko.renderToString = function(template, data) {
    const doc = new DOMParser().parseFromString(template, 'text/html');
    ko.applyBindings(data, doc.body);
    const htmlString = doc.body.innerHTML.toString();
    ko.cleanNode(doc);
    return htmlString;
};

ko.pc = function(read, write, owner) {
    return ko.pureComputed({ read, write, owner });
};

ko.isObservableArray = function(obs) {
    return ko.isObservable(obs) && typeof obs.push === 'function';
};

ko.fromRx = function(stream$) {
    const value = ko.observable();

    let streamSub = null;
    function onAwake() {
        streamSub = stream$.subscribe(value);
    }

    function onAsleep() {
        streamSub.unsubscribe();
        streamSub = null;
    }

    const pure = ko.pureComputed(value);
    pure.subscribe(onAwake, null, 'awake');
    pure.subscribe(onAsleep, null, 'asleep');
    return pure;
};

// Smart and fast assign of values to view model props.
// Take into account observables, observable arrays, typed observables
// and typed observable arrays.
ko.assignToProps = (ko => {
    const updateFuncs = new WeakMap();

    const templates = deepFreeze({
        STRUCT: (accessor, propValue) => {
            const block = _generateStructUpdateCode(propValue);
            return !block ? '' : `
                if (parent = vm, typeof (value = values${accessor}) !== 'undefined') {
                    const values = value, vm = parent${accessor};
                    ${block}
                }
            `;
        },
        VALUE: (accessor, _, owner) => {
            return Object.isFrozen(owner) ? '' : `
                if (typeof (value = values${accessor}) !== 'undefined') vm${accessor} = value;
            `;
        },
        OBS: accessor => `
            if (typeof (value = values${accessor}) !== 'undefined') vm${accessor}(value);
        `,
        TYPED_OBS: accessor => `
            if (typeof (value = values${accessor}) !== 'undefined') {
                const obs = vm${accessor};
                utils.updateTypedObs(obs, value, utils);
            }
        `,
        TYPED_OBS_ARRAY: accessor => `
            if (typeof (value = values${accessor}) !== 'undefined') {
                const obs = vm${accessor};
                utils.updateTypedObsArray(obs, value, utils);
            }
        `
    });

    const utils = deepFreeze({
        updateTypedObsArray: _updateTypedObsArray,
        updateTypedObs: _updateTypedObs
    });

    function _getPropType(value) {
        if (ko.isObservableArray(value)) {
            return value.typeInfo ?
                'TYPED_OBS_ARRAY' :
                'OBS';

        } else if (ko.isWritableObservable(value)) {
            return value.typeInfo ?
                'TYPED_OBS' :
                'OBS';

        } else if (!ko.isObservable(value) && !isFunction(value)) {
            return true &&
                (Array.isArray(value) && value.length > 0 && 'STRUCT') ||
                (isObject(value) && Object.keys(value).length > 0 && 'STRUCT') ||
                'VALUE';

        } else {
            return 'UNSUPPORTED';
        }
    }

    function _generateStructUpdateCode(vm) {
        const isArray = Array.isArray(vm);
        return Object.entries(vm)
            .map(pair => {
                const [propName, propValue] = pair;
                const propType = _getPropType(propValue);
                if (propType === 'UNSUPPORTED') {
                    return '';
                } else {
                    const isIndex = isArray && Number.isInteger(Number(propName));
                    const propAccessor = `[${isIndex ? propName : `'${propName}'`}]`;
                    return templates[propType](propAccessor, propValue, vm).trim();
                }
            })
            .filter(Boolean)
            .join('\n');
    }

    function _generateUpdateFunction(vm) {
        const body = `
            let value, parent;
            ${_generateStructUpdateCode(vm)}
        `.trim();

        return new Function('vm', 'values', 'utils', body);
    }

    function _updateTypedObsArray(obsArray, value, utils) {
        const { Type, params } = obsArray.typeInfo;
        const items = value.map((item, i) => {
            const itemVm = obsArray.peek()[i] || new Type(params);
            const update = _getUpdateFunc(itemVm);
            update(itemVm, item, utils);
            return itemVm;
        });
        obsArray(items);
    }

    function _updateTypedObs(obs, value, utils) {
        if (value === null) {
            obs(null);
        } else {
            const { Type, params } = obs.typeInfo;
            let  valueVm = obs.peek();
            if (valueVm == null) obs(valueVm = new Type(params));
            const update = _getUpdateFunc(valueVm);
            update(valueVm, value, utils);
        }
    }

    function _getUpdateFunc(obj) {
        const Type = obj.constructor;
        let update = updateFuncs.get(Type);
        if (!update) {
            updateFuncs.set(Type, update = _generateUpdateFunction(obj));
        }
        return update;
    }

    return function(vm, values) {
        const update = _getUpdateFunc(vm);
        update(vm, values, utils);
    };
})(ko);

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
    return ko.pureComputed(() => this() === ko.unwrap(value));
};

ko.subscribable.fn.notEq = function(value) {
    return ko.pureComputed(() => this() !== ko.unwrap(value));
};

ko.subscribable.fn.in = function(values) {
    return ko.pureComputed(() => ko.unwrap(values).includes(this()));
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

ko.subscribable.fn.ofType = function(Type, params) {
    if (typeof Type !== 'function') {
        throw new TypeError('Must be a constructor function');
    }
    this.typeInfo = { Type, params };
    return this;
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

import { equalIgnoreCase } from 'utils/string-utils';

// -----------------------------------------
// Binding syntax extentions
// -----------------------------------------
const bindPrefix = 'ko.';
const magicBindingName = '@';
const magicBindings = new Map();
const bindingNameMapping = new Map();
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

function getCanonicalBindingName(name) {
    if (ko.bindingHandlers.hasOwnProperty(name)) {
        return name;
    }

    if (bindingNameMapping.has(name)) {
        return bindingNameMapping.get(name);
    }

    const canonicalName = Object.keys(ko.bindingHandlers)
        .find(other => equalIgnoreCase(name, other));

    if (canonicalName) {
        bindingNameMapping.set(name, canonicalName);
        return canonicalName;
    }

    return null;
}

function preprocessElement(node) {
    const { attributes, dataset } = node;

    const bindings = Array.from(attributes)
        .filter(({ name }) => name.startsWith(bindPrefix))
        .map(({ name, value }) => {
            const [key, subKey] = name
                .substr(bindPrefix.length)
                .split('.');

            const canonicalKey = getCanonicalBindingName(key);
            const bindingName = subKey ? `${canonicalKey}.${subKey}` : canonicalKey;
            return [bindingName, value];
        });


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
    // Remove copyright comments from templates.
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
    let handler = origGetBindingHandler(name);
    if (handler) return handler;

    const [key, subKey] = name.split('.');
    if (subKey) {
        handler = origGetBindingHandler(key);
        if (handler) {
            handler = subclassBindingHandler(subKey, handler);
            ko.bindingHandlers[name] = handler;
        }
    }

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

global.ko = ko;


// Add lowercased copies of build-in bindings (to support the ko.<binding> attribute notation).
// Object.entries(ko.bindingHandlers)
//     .forEach(([name, binding]) => {
//         const lcName = name.toLowerCase();
//         if (lcName !== name) ko.bindingHandlers[lcName] = binding;
//     });

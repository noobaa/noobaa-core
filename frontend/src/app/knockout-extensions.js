import ko from 'knockout';
import { isObject, isUndefined, noop, deepFreeze, makeArray } from 'utils/core-utils';
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

ko.cmptd = function(read = noop, write = noop) {
    return ko.pureComputed({ read, write });
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
const preprocessByNodeType = deepFreeze({
    1: preprocessElement,
    3: preprocessTextNode
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
    const text = node.nodeValue.trim();
    if (text.match(/\$\{[\s\S]*?\}/)) {
        const parent = node.parentNode;
        const nodes = [
            document.createComment(` ko text: ko.uw\`${text}\` `),
            document.createComment(' /ko ')
        ];
        parent.insertBefore(nodes[0], node);
        parent.replaceChild(nodes[1], node);
        return nodes;
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

ko.bindingHandlers[magicBindingName] = {
    preprocess(key, _, addBinding) {
        for (const [name, value] of magicBindings.get(key)) {
            addBinding(name, value);
        }
        magicBindings.delete(key);
    }
};

ko.getBindingHandler = function(name) {
    const [ binding, key ] = name.split('.');
    let handler = bindingHandlers.get(name);
    if (!handler) {
        handler = origGetBindingHandler(binding);
        handler = key ? subclassBindingHandler(key, handler) : handler;
        bindingHandlers.set(name, handler);
    }
    return handler;
};

ko.uw = function(strings, ...values) {
    return makeArray(strings.length + values.length, i => {
        const j = Math.floor(i/2);
        return i % 2 ? ko.unwrap(values[j]) : strings[j];
    }).join('');
};

// -----------------------------------------
// Export knokcout object for dev purposes
// -----------------------------------------
global.ko = ko;


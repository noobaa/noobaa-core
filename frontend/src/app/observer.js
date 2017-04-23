/* Copyright (C) 2016 NooBaa */

const subscriptionsSym = Symbol('subscriptions');

export default class Observer {
    constructor() {
        this[subscriptionsSym] = [];
    }

    observe(subject, handler, target = this) {
        const sub = subject.subscribe(handler.bind(target));
        this[subscriptionsSym].push(sub);
    }

    dispose() {
        for (const sub of this[subscriptionsSym]) {
            sub.dispose();
        }
    }
}

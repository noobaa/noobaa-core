/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { tween } from 'shifty';

export default function tweenExtender(
    target,
    {
        duration = 1000,
        delay = 0,
        easing = 'easeOutQuad',
        resetValue = target(),
        resetOnChange = false,
        useDiscreteValues = false
    }
) {
    const result  = ko.observable(resetValue);
    tween({
        from: { val: resetValue },
        to: { val: target() },
        delay,
        duration,
        easing,
        step: ({ val }) => result(val)
    });

    // Create a pure observable to control the life time of the subscription
    // and to allow for automatic disposing in order to prevent memory leaks.
    const pure = ko.pureComputed(
        useDiscreteValues ? () => Math.round(result()) : result
    );

    let subscription;
    pure.subscribe(() => {
        subscription = target.subscribe(val =>
            tween({
                from: {
                    val: resetOnChange ? 0 : result()
                },
                to: { val },
                delay,
                duration,
                easing,
                step: ({ val }) => result(val)
            })
        );
    }, null, 'awake');

    pure.subscribe(() => {
        subscription.dispose();
    }, null, 'asleep');

    return pure;
}

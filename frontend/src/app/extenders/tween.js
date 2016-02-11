import ko from 'knockout';
import Tweenable from 'shifty';

function tween(fromValue, toValue, duration, easing, cb) {
    return (new Tweenable()).tween( {
        from: { val: fromValue },
        to: { val: toValue },
        duration: duration,
        easing: easing,
        step: ({ val }) => cb(val)
    });
}

export default function tweenExtender(
    target, 
    { 
        duration = 1000, 
        easing = 'easeOutQuad', 
        resetValue = target(),
        resetOnChange = false
    }
) {
    let result  = ko.observable(resetValue);
    tween(resetValue, target(), duration, easing, result);

    // Create a pure observable to controll the life time of the subscription
    // and to allow for automatic disposing in order to prevent memory leaks.
    let pure = ko.pureComputed(result);
    let subscription;

    pure.subscribe(function() {
        subscription = target.subscribe(
            val => tween(resetOnChange ? 0 : result(),  val, duration, easing, result)
        );
    }, null, 'awake');

    pure.subscribe(function() {
        subscription.dispose();
    }, null, 'asleep');
    
    return pure;
}
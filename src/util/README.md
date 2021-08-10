#util
===========
###Utils Table of Contents:

* [DebugLogger](#DebugLogger) - Our logging infrastructure.

* ###DebugLogger
  Encapsulation for winston. Gets a module name on creation (__filename) and uses winston to log
  according to current log levels of the module. Supports nested modules definitions and the ability to set a level
  of a higher module, affecting all of its sub modules.
  By using __filename upon creation, the created nested modules tree would reflect the source directory structure.
  Provides the following API:

    - .set_module_level(level) change current module logging level
    - .set_module_level(level,module) change given module logging level and all its sub-tree
    - .logX (...) logs if current module level or any of its parents >= X
    - .logX_withbt logs and adds backtrace if current module level or any of its parents >= X
    - trace / log / info / error / warn will always log. They exist to comply with syslog levels
      and replace usage of console.XXX in our modules. error and warn levels will be marked in RED.

  DebugLogger wraps the console thus promising that console logs will get written to the log file as well.

  Usage example:

  1) ___var dbg = require('noobaa-utils/debug-module')(__filename);___

     This will create an object dbg and will create the filename module (e.g. noobaa-core/src/some/module.js will create core.some.module). The default log level of the module is 0.

  2) Calling logX or logX_withbt will compare X to the current level of the module, if the current level is equal or higher, the message will be logged.

     ___dbg.log0("This message will be logged since the default level is 0");___

     ___dbg.log2("This message will not be logged since the default level is 0 and it's lower than 2");___

  3) Calling syslog levels logging will log the message regardless of the current module level.

     ___dbg.info("This message will be logged no matter what is the current level");___

  4) A level of a module can be set by using the set_level API.

     ___dbg.set_module_level(3); //This will cause the current module level to be 3___

     Another options is so set another module's level, this is especially beneficial when we want to catch all logs under a certain component. For example, setting level 3 for for every module under the "some" directory (including sub directories):

     ___dbg.set_module_level("core.some",3);___
